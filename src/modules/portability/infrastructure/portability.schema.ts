import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * D28, design §3.2, §3.5: one upload and what became of it. The file itself is never stored: only its SHA-256 and the
 * neutral snapshot read from it, which is technical data removed physically (set to null) 7 days after the batch is
 * confirmed, undone or abandoned as a draft; the row stays for the history. `mappings`, `counts`, `row_errors` and
 * `created` are the batch's own JSON documents (`drizzle-import-repositories.ts` reads and writes them).
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceApp: text("source_app").notNull(),
    fileSha256: text("file_sha256").notNull(),
    status: text("status", { enum: ["DRAFT", "CONFIRMED", "UNDONE"] }).notNull(),
    snapshot: jsonb("snapshot"),
    mappings: jsonb("mappings").notNull(),
    counts: jsonb("counts"),
    rowErrors: jsonb("row_errors").notNull(),
    created: jsonb("created").notNull(),
    createdAt: tz("created_at").notNull(),
    confirmedAt: tz("confirmed_at"),
    undoneAt: tz("undone_at"),
  },
  (t) => [
    index("import_batches_space_created_idx").on(t.spaceId, t.createdAt),
    index("import_batches_space_hash_idx").on(t.spaceId, t.fileSha256),
  ],
);

/**
 * D28, design §3.3: what a source row became in Hearth, so a re-import never writes it twice. The source key is the
 * source's own id (Money Manager's `uid`, `txUidTrans` for a transfer pair, `opening:<uid>` for an adjustment folded
 * into an opening balance). A logically deleted movement keeps its link; the links of an undone batch stop counting,
 * and a key linked again points at the newer entity.
 */
export const importLinks = pgTable(
  "import_links",
  {
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    sourceApp: text("source_app").notNull(),
    sourceKey: text("source_key").notNull(),
    entityType: text("entity_type", {
      enum: ["ACCOUNT", "CATEGORY", "CATEGORY_GROUP", "MOVEMENT", "PERSON"],
    }).notNull(),
    entityId: uuid("entity_id").notNull(),
    importId: uuid("import_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("import_links_source_uq").on(t.spaceId, t.sourceApp, t.sourceKey, t.entityType),
    index("import_links_import_idx").on(t.importId),
  ],
);
