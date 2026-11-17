import { and, desc, eq, isNotNull, lt, max, ne, sql } from "drizzle-orm";
import { isUuid } from "@/shared/kernel";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type {
  CreatedEntities,
  ImportBatch,
  ImportBatchRepository,
  ImportCounts,
  ImportLink,
  ImportLinkRepository,
  ImportMappings,
} from "../application";
import type { SourceIssue } from "../domain/source-snapshot";
import { importBatches, importLinks } from "./portability.schema";
import { decodeSnapshot, encodeSnapshot, type StoredSnapshot } from "./snapshot-codec";

type BatchRow = typeof importBatches.$inferSelect;

/**
 * P337: a draft stored before categories came as groups had a mapping per category, which no longer exists: it is
 * dropped, and such a draft archives the unused seeded categories as any new one does (the switch starts on).
 */
const mappingsOf = (stored: unknown): ImportMappings => {
  const raw = stored as Partial<ImportMappings> & Record<string, unknown>;
  return {
    timeZone: raw.timeZone!,
    accounts: raw.accounts ?? {},
    archiveUnusedCategories: raw.archiveUnusedCategories ?? true,
    includeDuplicates: raw.includeDuplicates ?? [],
  };
};

const batchOf = (row: BatchRow): ImportBatch => ({
  id: row.id,
  spaceId: row.spaceId,
  userId: row.userId,
  sourceApp: row.sourceApp,
  fileSha256: row.fileSha256,
  status: row.status,
  snapshot: row.snapshot === null ? null : decodeSnapshot(row.snapshot as StoredSnapshot),
  mappings: mappingsOf(row.mappings),
  // Counts stored before restores were counted lack those two fields: such a confirm restored nothing; and those
  // stored before P337 lack its two: it added no person and archived no account.
  counts:
    row.counts === null
      ? null
      : ({
          accountsRestored: 0,
          categoriesRestored: 0,
          peopleCreated: 0,
          accountsArchived: 0,
          hearthCategoriesArchived: 0,
          ...(row.counts as Partial<ImportCounts>),
        } as ImportCounts),
  rowErrors: row.rowErrors as SourceIssue[],
  // P337: a batch stored before it recorded no settlement, opened no direct space, made no group, archived nothing.
  created: {
    settlements: [],
    people: [],
    groups: [],
    archivedSeeded: { groups: [], categories: [] },
    ...(row.created as Partial<CreatedEntities>),
  } as CreatedEntities,
  createdAt: row.createdAt,
  confirmedAt: row.confirmedAt,
  undoneAt: row.undoneAt,
});

const rowOf = (batch: ImportBatch) => ({
  id: batch.id,
  spaceId: batch.spaceId,
  userId: batch.userId,
  sourceApp: batch.sourceApp,
  fileSha256: batch.fileSha256,
  status: batch.status,
  snapshot: batch.snapshot === null ? null : encodeSnapshot(batch.snapshot),
  mappings: batch.mappings,
  counts: batch.counts,
  rowErrors: batch.rowErrors,
  created: batch.created,
  createdAt: batch.createdAt,
  confirmedAt: batch.confirmedAt,
  undoneAt: batch.undoneAt,
});

/** D28: the import batches. Ids from a URL are checked before they reach the `uuid` column. */
export class DrizzleImportBatches implements ImportBatchRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(batch: ImportBatch): Promise<void> {
    await this.tm.executor().insert(importBatches).values(rowOf(batch));
  }

  find(spaceId: string, importId: string): Promise<ImportBatch | null> {
    return this.findOne(spaceId, importId, false);
  }

  findForUpdate(spaceId: string, importId: string): Promise<ImportBatch | null> {
    return this.findOne(spaceId, importId, true);
  }

  private async findOne(spaceId: string, importId: string, lock: boolean): Promise<ImportBatch | null> {
    if (!isUuid(importId) || !isUuid(spaceId)) return null;
    const query = this.tm
      .executor()
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.spaceId, spaceId), eq(importBatches.id, importId)));
    const [row] = lock ? await query.for("update") : await query;
    return row === undefined ? null : batchOf(row);
  }

  async save(batch: ImportBatch): Promise<void> {
    const { id, spaceId, ...changes } = rowOf(batch);
    await this.tm
      .executor()
      .update(importBatches)
      .set(changes)
      .where(and(eq(importBatches.id, id), eq(importBatches.spaceId, spaceId)));
  }

  async listBySpace(spaceId: string): Promise<ImportBatch[]> {
    if (!isUuid(spaceId)) return [];
    // The snapshot can be megabytes; the history never reads it.
    const rows = await this.tm
      .executor()
      .select({
        id: importBatches.id,
        spaceId: importBatches.spaceId,
        userId: importBatches.userId,
        sourceApp: importBatches.sourceApp,
        fileSha256: importBatches.fileSha256,
        status: importBatches.status,
        mappings: importBatches.mappings,
        counts: importBatches.counts,
        rowErrors: importBatches.rowErrors,
        created: importBatches.created,
        createdAt: importBatches.createdAt,
        confirmedAt: importBatches.confirmedAt,
        undoneAt: importBatches.undoneAt,
      })
      .from(importBatches)
      .where(eq(importBatches.spaceId, spaceId))
      .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
    return rows.map((row) => batchOf({ ...row, snapshot: null }));
  }

  async lastConfirmedWithHash(spaceId: string, fileSha256: string, exceptId: string): Promise<Date | null> {
    const [row] = await this.tm
      .executor()
      .select({ at: max(importBatches.confirmedAt) })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.spaceId, spaceId),
          eq(importBatches.fileSha256, fileSha256),
          eq(importBatches.status, "CONFIRMED"),
          ne(importBatches.id, exceptId),
        ),
      );
    return row?.at ?? null;
  }

  async removeSnapshotsSettledBefore(before: Date): Promise<number> {
    // A confirmed or undone batch counts from its confirm; a draft never confirmed, from its upload (abandoned).
    const removed = await this.tm
      .executor()
      .update(importBatches)
      .set({ snapshot: null })
      .where(
        and(
          isNotNull(importBatches.snapshot),
          lt(sql`coalesce(${importBatches.confirmedAt}, ${importBatches.createdAt})`, before),
        ),
      )
      .returning({ id: importBatches.id });
    return removed.length;
  }
}

/** Rows per INSERT: 6 parameters each, far below PostgreSQL's 65,535 per statement. */
const LINK_BATCH = 5000;

/** D28, design §3.3: what each source row became; an undone batch's links are left out of every read. */
export class DrizzleImportLinks implements ImportLinkRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  linksOf(spaceId: string, sourceApp: string): Promise<ImportLink[]> {
    return this.read(spaceId, sourceApp, false);
  }

  private async read(spaceId: string, sourceApp: string, undone: boolean): Promise<ImportLink[]> {
    if (!isUuid(spaceId)) return [];
    return this.tm
      .executor()
      .select({
        spaceId: importLinks.spaceId,
        sourceApp: importLinks.sourceApp,
        sourceKey: importLinks.sourceKey,
        entityType: importLinks.entityType,
        entityId: importLinks.entityId,
        importId: importLinks.importId,
      })
      .from(importLinks)
      .innerJoin(importBatches, eq(importBatches.id, importLinks.importId))
      .where(
        and(
          eq(importLinks.spaceId, spaceId),
          eq(importLinks.sourceApp, sourceApp),
          undone ? eq(importBatches.status, "UNDONE") : ne(importBatches.status, "UNDONE"),
        ),
      );
  }

  async undoneLinksOf(spaceId: string, sourceApp: string): Promise<ImportLink[]> {
    return this.read(spaceId, sourceApp, true);
  }

  async upsert(links: readonly ImportLink[]): Promise<void> {
    for (let at = 0; at < links.length; at += LINK_BATCH) {
      await this.tm
        .executor()
        .insert(importLinks)
        .values(links.slice(at, at + LINK_BATCH).map((link) => ({ ...link })))
        .onConflictDoUpdate({
          target: [importLinks.spaceId, importLinks.sourceApp, importLinks.sourceKey, importLinks.entityType],
          set: { entityId: sql`excluded.entity_id`, importId: sql`excluded.import_id` },
        });
    }
  }
}
