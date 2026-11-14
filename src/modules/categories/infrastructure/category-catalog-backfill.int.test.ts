import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { DEFAULT_CATALOG } from "../domain/default-catalog";

const TAG = "0032_category_catalog";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0032: the schema and the seed a database had before ruling P330. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0032-"));
const databases: { name: string; client?: pg.Client }[] = [];

/** HU-E3-01's catalog as it was before P330, by key: the keys the P330 domain test pins as unchanged. */
const BEFORE_P330: Record<string, readonly string[]> = {
  housing: ["rent", "utilities", "maintenance"],
  food: ["groceries", "restaurants"],
  transport: ["fuel", "public_transport"],
  health: ["medical", "pharmacy"],
  leisure: ["entertainment", "travel"],
  income: ["salary", "other_income"],
};
const OLD_TREE = DEFAULT_CATALOG.filter((group) => group.key in BEFORE_P330).map((group) => ({
  ...group,
  categories: group.categories.filter((category) => BEFORE_P330[group.key]!.includes(category.key)),
}));
const NEW_GROUPS = DEFAULT_CATALOG.filter((group) => !(group.key in BEFORE_P330));
const catalogGroup = (key: string) => DEFAULT_CATALOG.find((group) => group.key === key)!;

beforeAll(async () => {
  await admin.connect();
  cpSync("drizzle", before, { recursive: true });
  const journalFile = join(before, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(cut).toBeGreaterThan(0);
  writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }));
});

afterAll(async () => {
  const failures: unknown[] = [];
  const attempt = async (step: () => unknown) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  for (const database of databases) {
    await attempt(() => database.client?.end());
    await attempt(() => admin.query(`DROP DATABASE IF EXISTS ${database.name} WITH (FORCE)`));
  }
  await attempt(() => admin.end());
  await attempt(() => rmSync(before, { recursive: true, force: true }));
  if (failures.length > 0)
    throw new AggregateError(failures, "Cleaning up the back-fill test databases failed");
});

/** A fresh database migrated up to 0031, with helpers to lay out spaces as they were before P330. */
async function openDatabase() {
  const database: { name: string; client?: pg.Client } = { name: `m_${randomUUID().replaceAll("-", "")}` };
  databases.push(database);
  await admin.query(`CREATE DATABASE ${database.name}`);
  const url = new URL(inject("adminDatabaseUrl"));
  url.pathname = `/${database.name}`;
  await runMigrations(url.toString(), before);
  const client = new pg.Client({ connectionString: url.toString() });
  database.client = client;
  await client.connect();

  const space = async (options: { archived?: boolean } = {}): Promise<string> => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at, archived_at)
       VALUES ($1, 'Household', 'SHARED', 'COP', '{}', now(), CASE WHEN $2::boolean THEN now() END)`,
      [id, options.archived ?? false],
    );
    return id;
  };

  /** A group of `spaceId` at the next place; `key` null for one the person created. */
  const group = async (
    spaceId: string,
    name: string,
    key: string | null,
    style = { icon: "tag", color: "GRAPHITE" },
  ) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO category_groups (id, space_id, name, key, icon_kind, icon_value, color, position, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'SYMBOL', $4, $5,
               (SELECT count(*) FROM category_groups WHERE space_id = $1), now())
       RETURNING id`,
      [spaceId, name, key, style.icon, style.color],
    );
    return rows[0]!.id;
  };

  const category = async (
    spaceId: string,
    groupId: string,
    name: string,
    key: string | null,
    style = { icon: "tag", color: "GRAPHITE" },
  ) => {
    await client.query(
      `INSERT INTO categories (id, space_id, group_id, name, key, icon_kind, icon_value, color, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SYMBOL', $5, $6, now())`,
      [spaceId, groupId, name, key, style.icon, style.color],
    );
  };

  /** A space seeded with HU-E3-01's tree as it was before P330, in `language`; its group ids by key. */
  const seededSpace = async (
    language: "es" | "en",
  ): Promise<{ spaceId: string; groups: Map<string, string> }> => {
    const spaceId = await space();
    const groups = new Map<string, string>();
    for (const entry of OLD_TREE) {
      const groupId = await group(spaceId, entry.names[language], entry.key, entry);
      groups.set(entry.key, groupId);
      for (const item of entry.categories)
        await category(spaceId, groupId, item.names[language], item.key, {
          icon: item.icon,
          color: entry.color,
        });
    }
    return { spaceId, groups };
  };

  /** Every stored group and category, so a comparison catches any change to any column. */
  const everything = async () => ({
    groups: (await client.query(`SELECT * FROM category_groups ORDER BY id`)).rows,
    categories: (await client.query(`SELECT * FROM categories ORDER BY id`)).rows,
  });

  const groupsOf = async (spaceId: string) =>
    (
      await client.query<{
        key: string | null;
        name: string;
        position: number;
        icon_value: string;
        color: string;
      }>(
        `SELECT key, name, position, icon_value, color FROM category_groups WHERE space_id = $1 ORDER BY position`,
        [spaceId],
      )
    ).rows;

  /** The categories of a space as [group key, category key, name], in catalog-independent order. */
  const categoriesOf = async (spaceId: string) =>
    (
      await client.query<{ group_key: string | null; key: string | null; name: string }>(
        `SELECT g.key AS group_key, c.key, c.name
         FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE c.space_id = $1 ORDER BY g.position, c.name COLLATE "C"`,
        [spaceId],
      )
    ).rows.map((row) => [row.group_key, row.key, row.name]);

  return {
    url: url.toString(),
    client,
    space,
    group,
    category,
    seededSpace,
    everything,
    groupsOf,
    categoriesOf,
    /** Runs the pending migration, 0032, the way a deploy does. */
    migrate: () => runMigrations(url.toString(), "drizzle"),
    /** Runs 0032's statements once more in a transaction, as a second deploy of the same SQL would. */
    rerun: async () => {
      await client.query("BEGIN");
      for (const statement of readFileSync(`drizzle/${TAG}.sql`, "utf8").split("--> statement-breakpoint"))
        await client.query(statement);
      await client.query("COMMIT");
    },
  };
}

/** The whole tree of a space seeded in `language` after the back-fill, as [group key, category key, name]. */
const fullTree = (language: "es" | "en", skip: (groupKey: string, key: string) => boolean = () => false) =>
  [...OLD_TREE, ...NEW_GROUPS].flatMap((group) =>
    catalogGroup(group.key)
      .categories.filter((category) => !skip(group.key, category.key))
      .map((category) => [group.key, category.key, category.names[language]])
      .sort((a, b) => (a[2]! < b[2]! ? -1 : a[2]! > b[2]! ? 1 : 0)),
  );

describe(`${TAG} back-fill (ruling P330)`, () => {
  it("gives existing spaces what the catalog added, by key and in their language, once, changing nothing else", async () => {
    const db = await openDatabase();
    const es = await db.seededSpace("es");
    const en = await db.seededSpace("en");
    // The person renamed Transporte and restyled it: Taxi y apps still goes there, by key, in its color.
    const renamed = await db.seededSpace("es");
    await db.client.query(`UPDATE category_groups SET name = 'Movilidad', color = 'EMBER' WHERE id = $1`, [
      renamed.groups.get("transport"),
    ]);
    // An archived group takes nothing.
    const archived = await db.seededSpace("es");
    await db.client.query(`UPDATE category_groups SET archived_at = now() WHERE id = $1`, [
      archived.groups.get("leisure"),
    ]);
    // A custom category named like a new one blocks only that one; a custom group named like a new group blocks it.
    const custom = await db.seededSpace("es");
    await db.category(custom.spaceId, custom.groups.get("food")!, "domicilios", null);
    await db.group(custom.spaceId, "Mascotas", null);
    // A space with no categories, and an archived space, are left alone.
    const empty = await db.space();
    const archivedSpace = await db.space({ archived: true });
    const archivedGroupId = await db.group(archivedSpace, "Vivienda", "housing");
    await db.category(archivedSpace, archivedGroupId, "Arriendo", "rent");

    const stored = await db.everything();
    await db.migrate();
    const after = await db.everything();

    // Nothing existing is renamed, moved or restyled.
    const ids = new Set([...stored.groups, ...stored.categories].map((row) => row.id as string));
    expect({
      groups: after.groups.filter((row) => ids.has(row.id as string)),
      categories: after.categories.filter((row) => ids.has(row.id as string)),
    }).toEqual(stored);

    // New groups come after the space's own, in catalog order, with the catalog's style; categories by key.
    const expectedGroups = (language: "es" | "en") =>
      [...OLD_TREE, ...NEW_GROUPS].map((group, position) => ({
        key: group.key,
        name: group.names[language],
        position,
        icon_value: group.icon,
        color: group.color,
      }));
    expect(await db.groupsOf(es.spaceId)).toEqual(expectedGroups("es"));
    expect(await db.categoriesOf(es.spaceId)).toEqual(fullTree("es"));
    expect(await db.groupsOf(en.spaceId)).toEqual(expectedGroups("en"));
    expect(await db.categoriesOf(en.spaceId)).toEqual(fullTree("en"));

    const taxi = await db.client.query(
      `SELECT c.name, c.icon_value, c.color, g.name AS group_name
       FROM categories c JOIN category_groups g ON g.id = c.group_id
       WHERE c.space_id = $1 AND c.key = 'ride_hailing'`,
      [renamed.spaceId],
    );
    expect(taxi.rows).toEqual([
      { name: "Taxi y apps", icon_value: "car", color: "EMBER", group_name: "Movilidad" },
    ]);

    expect(await db.categoriesOf(archived.spaceId)).toEqual(
      fullTree("es", (groupKey, key) => groupKey === "leisure" && !BEFORE_P330.leisure!.includes(key)),
    );

    const customGroups = await db.groupsOf(custom.spaceId);
    expect(customGroups.map((g) => g.key)).not.toContain("pets");
    expect(customGroups.filter((g) => g.name === "Mascotas")).toHaveLength(1);
    expect(customGroups.map((g) => g.position)).toEqual(customGroups.map((_, index) => index));
    expect(await db.categoriesOf(custom.spaceId)).toEqual(
      expect.arrayContaining([
        ["food", null, "domicilios"],
        ["food", "snacks", "Café y snacks"],
      ]),
    );
    expect((await db.categoriesOf(custom.spaceId)).map(([, key]) => key)).not.toEqual(
      expect.arrayContaining(["delivery"]),
    );
    expect((await db.categoriesOf(custom.spaceId)).map(([, key]) => key)).not.toEqual(
      expect.arrayContaining(["pet_care"]),
    );

    expect(await db.groupsOf(empty)).toEqual([]);
    expect((await db.groupsOf(archivedSpace)).map((g) => g.key)).toEqual(["housing"]);
    expect(await db.categoriesOf(archivedSpace)).toEqual([["housing", "rent", "Arriendo"]]);

    // A second run adds nothing.
    await db.rerun();
    expect(await db.everything()).toEqual(after);
  });

  it("never adds back a group or category of the first catalog that a space no longer has", async () => {
    const db = await openDatabase();
    const space = await db.seededSpace("es");
    // Salud lost its key (renamed, its categories unkeyed): its people removed it from the catalog.
    await db.client.query(`UPDATE category_groups SET key = NULL, name = 'Bienestar' WHERE id = $1`, [
      space.groups.get("health"),
    ]);
    await db.client.query(
      `UPDATE categories SET key = NULL WHERE space_id = $1 AND key IN ('medical', 'pharmacy')`,
      [space.spaceId],
    );

    await db.migrate();

    expect((await db.groupsOf(space.spaceId)).map((g) => g.key)).not.toContain("health");
    const keys = (await db.categoriesOf(space.spaceId)).map(([, key]) => key);
    expect(keys).not.toEqual(expect.arrayContaining(["medical"]));
    expect(keys).not.toEqual(expect.arrayContaining(["pharmacy"]));
    // The new groups still arrive.
    expect((await db.groupsOf(space.spaceId)).map((g) => g.key)).toContain("subscriptions");
  });

  it("repeats DEFAULT_CATALOG in its lists, so the back-fill and the seed never drift", () => {
    const sql = readFileSync(`drizzle/${TAG}.sql`, "utf8");
    const values = (table: string) => {
      const match = new RegExp(`INSERT INTO "${table}" \\([^)]*\\) VALUES([\\s\\S]*?);`).exec(sql);
      expect(match, table).not.toBeNull();
      return [...match![1]!.matchAll(/\(([^()]*)\)/g)].map((tuple) =>
        tuple[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, "")),
      );
    };
    expect(values("p330_groups")).toEqual(
      DEFAULT_CATALOG.map((g, position) => [
        g.key,
        g.names.es,
        g.names.en,
        g.icon,
        g.color,
        String(position),
      ]),
    );
    expect(values("p330_categories")).toEqual(
      DEFAULT_CATALOG.flatMap((g) => g.categories.map((c) => [c.key, g.key, c.names.es, c.names.en, c.icon])),
    );
  });
});
