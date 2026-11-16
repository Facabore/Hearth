import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { fixedTimeZones } from "../../../../tests/support/fakes";
import { personalSpaceFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../../../tests/support/locks";
import { moneyManagerBackup } from "../../../../tests/support/money-manager-backup";
import {
  createConfirmImport,
  createRemoveExpiredSnapshots,
  createStartImport,
  NOTHING_CREATED,
  type ImportBatch,
  type ImportDeps,
  type ImportWriter,
} from "../application";
import { DrizzleImportBatches, DrizzleImportLinks } from "./drizzle-import-repositories";
import { MoneyManagerAdapter } from "./money-manager-adapter";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const ids = new UuidV7IdGenerator();
const clock = new FixedClock(new Date("2026-11-16T15:00:00Z"));

afterAll(() => pool.end());

/** An `ImportWriter` that writes nothing: every create answers a fresh id and is counted. */
const countingWriter = (): ImportWriter & { readonly recorded: string[] } => {
  const recorded: string[] = [];
  const otros = randomUUID();
  const id = async () => ok(randomUUID());
  return {
    recorded,
    targetsOf: async () =>
      ok({ accounts: [], groups: [{ id: otros, key: "other", archived: false }], categories: [] }),
    movementsOf: async () => [],
    createAccount: id,
    createCategory: id,
    recordExpense: async (input) => {
      recorded.push(input.description ?? "expense");
      return id();
    },
    recordIncome: async () => {
      recorded.push("income");
      return id();
    },
    recordTransfer: async () => {
      recorded.push("transfer");
      return id();
    },
    deleteMovement: async () => ok(undefined),
    archiveAccount: async () => ok(undefined),
    archiveCategory: async () => ok(undefined),
    accountInUse: async () => false,
    categoryInUse: async () => false,
  };
};

const depsWith = (overrides: Partial<ImportDeps> = {}): ImportDeps => ({
  access: createSpaceAccess(spaces),
  spaceLocks: spaces,
  reader: { read: async (bytes) => new MoneyManagerAdapter().read({ bytes }) },
  batches: new DrizzleImportBatches(tm),
  links: new DrizzleImportLinks(tm),
  writer: countingWriter(),
  digest: () => "f".repeat(64),
  ids,
  clock,
  userTimeZones: fixedTimeZones(),
  tm,
  ...overrides,
});

const draftIn = async (space: SpaceFixture, deps = depsWith()): Promise<string> => {
  const started = await createStartImport(deps)({ ...space, bytes: moneyManagerBackup() });
  if (!started.ok) throw new Error(started.error.code);
  return started.value.id;
};

const batchFor = (space: SpaceFixture, overrides: Partial<ImportBatch>): ImportBatch => ({
  id: randomUUID(),
  spaceId: space.spaceId,
  userId: space.userId,
  sourceApp: "money-manager",
  fileSha256: "a".repeat(64),
  status: "DRAFT",
  snapshot: null,
  mappings: { timeZone: "America/Bogota", accounts: {}, categories: {}, includeDuplicates: [] },
  counts: null,
  rowErrors: [],
  created: NOTHING_CREATED,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  confirmedAt: null,
  undoneAt: null,
  ...overrides,
});

describe("DrizzleImportBatches (D28, design §3.5)", () => {
  const batches = new DrizzleImportBatches(tm);

  it("keeps a draft's snapshot exactly: every amount in minor units, every instant, every row", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const read = new MoneyManagerAdapter().read({ bytes: moneyManagerBackup() });
    if (!read.ok) throw new Error(read.error.code);
    const batch = batchFor(ana, { snapshot: read.value });
    await batches.add(batch);
    expect(await batches.find(ana.spaceId, batch.id)).toEqual(batch);
    expect(await batches.find(ana.spaceId, "not-a-uuid")).toBeNull();
    expect(await batches.find(randomUUID(), batch.id)).toBeNull();
  });

  it("removes the snapshot of every batch settled or abandoned 7 days ago, and keeps the rows and newer snapshots", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const read = new MoneyManagerAdapter().read({ bytes: moneyManagerBackup() });
    if (!read.ok) throw new Error(read.error.code);
    const snapshot = read.value;
    const at = (iso: string) => new Date(iso);
    // The clock reads 2026-11-16T15:00Z: seven days before is 2026-11-09T15:00Z.
    const abandoned = batchFor(ana, { snapshot, createdAt: at("2026-11-09T14:59:00Z") });
    const confirmedLongAgo = batchFor(ana, {
      snapshot,
      status: "CONFIRMED",
      createdAt: at("2026-11-01T00:00:00Z"),
      confirmedAt: at("2026-11-02T00:00:00Z"),
    });
    const undone = batchFor(ana, {
      snapshot,
      status: "UNDONE",
      createdAt: at("2026-11-01T00:00:00Z"),
      confirmedAt: at("2026-11-03T00:00:00Z"),
      undoneAt: at("2026-11-15T00:00:00Z"),
    });
    const confirmedRecently = batchFor(ana, {
      snapshot,
      status: "CONFIRMED",
      createdAt: at("2026-11-01T00:00:00Z"),
      confirmedAt: at("2026-11-10T00:00:00Z"),
    });
    const freshDraft = batchFor(ana, { snapshot, createdAt: at("2026-11-12T00:00:00Z") });
    for (const batch of [abandoned, confirmedLongAgo, undone, confirmedRecently, freshDraft])
      await batches.add(batch);

    const removed = await createRemoveExpiredSnapshots({ batches, clock })();

    // Other suites' batches may share the database; this space's five are the ones checked.
    expect(removed).toBeGreaterThanOrEqual(3);
    const kept = async (batch: ImportBatch) => (await batches.find(ana.spaceId, batch.id))?.snapshot !== null;
    expect(await kept(abandoned)).toBe(false);
    expect(await kept(confirmedLongAgo)).toBe(false);
    expect(await kept(undone)).toBe(false);
    expect(await kept(confirmedRecently)).toBe(true);
    expect(await kept(freshDraft)).toBe(true);
    expect((await batches.listBySpace(ana.spaceId)).map((b) => b.id).sort()).toEqual(
      [abandoned, confirmedLongAgo, undone, confirmedRecently, freshDraft].map((b) => b.id).sort(),
    );
  });

  it("names the last confirm of a file by its hash, never the batch asking or an undone one", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const hash = "b".repeat(64);
    const first = batchFor(ana, {
      fileSha256: hash,
      status: "CONFIRMED",
      confirmedAt: new Date("2026-11-03T00:00:00Z"),
    });
    const undone = batchFor(ana, {
      fileSha256: hash,
      status: "UNDONE",
      confirmedAt: new Date("2026-11-05T00:00:00Z"),
      undoneAt: new Date("2026-11-06T00:00:00Z"),
    });
    const asking = batchFor(ana, { fileSha256: hash });
    for (const batch of [first, undone, asking]) await batches.add(batch);
    expect(await batches.lastConfirmedWithHash(ana.spaceId, hash, asking.id)).toEqual(first.confirmedAt);
    expect(await batches.lastConfirmedWithHash(ana.spaceId, hash, first.id)).toBeNull();
  });
});

describe("DrizzleImportLinks (D28, design §3.3)", () => {
  const batches = new DrizzleImportBatches(tm);
  const links = new DrizzleImportLinks(tm);

  it("leaves out an undone batch's links, and points a key linked again at the newer entity", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const undone = batchFor(ana, { status: "UNDONE" });
    const live = batchFor(ana, { status: "CONFIRMED" });
    await batches.add(undone);
    await batches.add(live);
    const link = (importId: string, sourceKey: string, entityId = randomUUID()) => ({
      spaceId: ana.spaceId,
      sourceApp: "money-manager",
      sourceKey,
      entityType: "MOVEMENT" as const,
      entityId,
      importId,
    });
    await links.upsert([link(undone.id, "m1"), link(undone.id, "m2"), link(live.id, "m3")]);
    expect((await links.linksOf(ana.spaceId, "money-manager")).map((l) => l.sourceKey)).toEqual(["m3"]);

    const again = link(live.id, "m1");
    await links.upsert([again]);
    expect(
      (await links.linksOf(ana.spaceId, "money-manager")).map((l) => [l.sourceKey, l.entityId]).sort(),
    ).toEqual([
      ["m1", again.entityId],
      ["m3", expect.any(String)],
    ]);
    expect(await links.linksOf(ana.spaceId, "another-app")).toEqual([]);
  });
});

/** The real batches repository, but the save of a confirmed batch stops in `h.hold()` once it is written. */
class HoldingConfirm extends DrizzleImportBatches {
  constructor(private readonly h: ReturnType<typeof holder>) {
    super(tm);
  }

  override async save(batch: ImportBatch): Promise<void> {
    await super.save(batch);
    if (batch.status === "CONFIRMED") await this.h.hold();
  }
}

describe("two confirms of one draft (D28, design §3.2)", () => {
  it("imports it once: the second waits for the first's lock on the batch, then finds it confirmed", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const writer = countingWriter();
    const importId = await draftIn(ana, depsWith({ writer }));
    const h = holder(tm, pool);
    const first = createConfirmImport(depsWith({ writer, batches: new HoldingConfirm(h) }))({
      ...ana,
      importId,
    });
    // The first confirm has written everything, not committed: the second queues behind its lock on the batch row.
    await heldBy(h, first);
    const second = createConfirmImport(depsWith({ writer }))({ ...ana, importId }).finally(h.release);

    expect(await outcomesOf(first, second)).toEqual(["ImportNotDraft", "ok"]);
    // m6 is recorded too: this writer converts nothing, so no row fails for want of a rate.
    expect(writer.recorded.sort()).toEqual([
      "Almuerzo",
      "expense",
      "expense",
      "expense",
      "income",
      "transfer",
    ]);
  });
});
