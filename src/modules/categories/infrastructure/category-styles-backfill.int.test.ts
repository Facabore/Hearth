import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { DEFAULT_CATALOG } from "../domain/default-catalog";

const TAG = "0017_category_styles";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0017: the schema a database had before HU-E3-05. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0017-"));
/** Every database a test opened, registered before it is migrated or connected so `afterAll` always drops it. */
const databases: { name: string; client?: pg.Client }[] = [];

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
  // Each step runs whatever the others did, so one failure never leaves a database, the admin connection or the
  // temporary copy of drizzle/ behind; the failures are rethrown together.
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

/** A space as it existed before HU-E3-05: where the groups and categories of a scenario are stored and read. */
function inSpace(client: pg.Client, space: string) {
  const rows = async (query: string): Promise<Record<string, unknown>[]> =>
    (await client.query<Record<string, unknown>>(query, [space])).rows;
  return {
    space,
    /** The rows of a query that takes the space as `$1`. */
    rows,
    /** The groups of the space with their key and style, by name. */
    styledGroups: () =>
      rows(
        `SELECT name, key, icon_value, color FROM category_groups WHERE space_id = $1 ORDER BY name COLLATE "C"`,
      ),
    /** The categories of the space with their style, by name. */
    styledCategories: () =>
      rows(
        `SELECT name, icon_kind, icon_value, color FROM categories WHERE space_id = $1 ORDER BY name COLLATE "C"`,
      ),
    /** A group as it existed before HU-E3-05: a name and a creation day of January 2026 (the oldest breaks ties). */
    group: async (name: string, day: number): Promise<string> => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO category_groups (id, space_id, name, created_at) VALUES ($1, $2, $3, $4)`,
        [id, space, name, new Date(Date.UTC(2026, 0, day))],
      );
      return id;
    },
    /** A category as it existed before HU-E3-05: no style, optionally a subcategory or a deleted one. */
    category: async (
      groupId: string,
      name: string,
      key: string | null,
      options: { parent?: string; deleted?: boolean } = {},
    ): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO categories (id, space_id, group_id, parent_category_id, name, key, deleted_at, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END, now()) RETURNING id`,
        [space, groupId, options.parent ?? null, name, key, options.deleted ?? false],
      );
      return rows[0]!.id;
    },
  };
}

async function insertSpace(client: pg.Client): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
     VALUES ($1, 'Household', 'SHARED', 'COP', '{}', now())`,
    [id],
  );
  return id;
}

/** A fresh database migrated with the migrations of `folder`, holding one space; `newSpace` adds another. */
async function openDatabase(folder: string) {
  const database: { name: string; client?: pg.Client } = { name: `m_${randomUUID().replaceAll("-", "")}` };
  databases.push(database);
  await admin.query(`CREATE DATABASE ${database.name}`);
  const url = new URL(inject("adminDatabaseUrl"));
  url.pathname = `/${database.name}`;
  await runMigrations(url.toString(), folder);
  const client = new pg.Client({ connectionString: url.toString() });
  database.client = client;
  await client.connect();
  return {
    url: url.toString(),
    client,
    newSpace: async () => inSpace(client, await insertSpace(client)),
    ...inSpace(client, await insertSpace(client)),
  };
}

/** The one statement of the migration file that contains `marker`, so a rewrite of the SQL cannot skip a step silently. */
function backfillStatement(marker: string): string {
  const matches = readFileSync(`drizzle/${TAG}.sql`, "utf8")
    .split("--> statement-breakpoint")
    .filter((statement) => statement.includes(marker));
  expect(matches, `statements of ${TAG}.sql containing ${marker}`).toHaveLength(1);
  return matches[0]!;
}

describe(`${TAG} back-fill (HU-E3-05, rulings P56, P57, P77 and P78)`, () => {
  it("keys the seeded groups and styles every row, leaving the others keyless and subcategories unstyled", async () => {
    const db = await openDatabase(before);
    // Groups, oldest first: a tie goes to the older one.
    const taller = await db.group("Taller", 1);
    const casa = await db.group("Casa", 2);
    const despensa = await db.group("Despensa", 3);
    const fuera = await db.group("Fuera", 4);
    const mixto = await db.group("Mixto", 5);
    const hogar = await db.group("Hogar", 6);
    await db.group("salud", 7);
    const health = await db.group("Health", 8);
    await db.group("Ingresos", 9);
    const mascotas = await db.group("Mascotas", 10);
    await db.group("Vivienda", 11);
    // Housing: "Casa" holds the most of it (2 against 1) although "Taller" is older.
    await db.category(taller, "Mantenimiento", "maintenance");
    await db.category(casa, "Arriendo", "rent");
    await db.category(casa, "Servicios", "utilities");
    // Food: a tie of 1 and 1, so the older "Despensa" keeps the key and "Fuera" stays without one.
    const mercado = await db.category(despensa, "Mercado", "groceries");
    await db.category(despensa, "Panadería", null);
    await db.category(despensa, "Verduras", null, { parent: mercado });
    await db.category(fuera, "Restaurantes", "restaurants");
    // "Mixto" holds two Leisure categories and one Health: the most wins over catalog order.
    await db.category(mixto, "Cine", "entertainment");
    await db.category(mixto, "Viajes", "travel");
    await db.category(mixto, "Farmacia", "pharmacy");
    // "Hogar" holds one Transport and one Income category: a tie goes to the first in catalog order.
    await db.category(hogar, "Gasolina", "fuel");
    await db.category(hogar, "Salario", "salary");
    // "Health" and "Ingresos" hold no seeded category and match a seed name exactly, "salud" is a near miss of
    // "Salud", "Vivienda" matches a name whose key "Casa" holds, and a deleted category is not held.
    await db.category(health, "Gimnasio", null);
    await db.category(mascotas, "Veterinario", null);
    await db.category(mascotas, "Otros ingresos", "other_income", { deleted: true });
    await runMigrations(db.url);
    expect(await db.styledGroups()).toEqual([
      { name: "Casa", key: "housing", icon_value: "home", color: "INDIGO" },
      { name: "Despensa", key: "food", icon_value: "apple", color: "SAND" },
      { name: "Fuera", key: null, icon_value: "tag", color: "GRAPHITE" },
      { name: "Health", key: "health", icon_value: "heart", color: "ROSE" },
      { name: "Hogar", key: "transport", icon_value: "car", color: "STEEL" },
      { name: "Ingresos", key: "income", icon_value: "coins", color: "PINE" },
      { name: "Mascotas", key: null, icon_value: "tag", color: "GRAPHITE" },
      { name: "Mixto", key: "leisure", icon_value: "ticket", color: "PLUM" },
      { name: "Taller", key: null, icon_value: "tag", color: "GRAPHITE" },
      { name: "Vivienda", key: null, icon_value: "tag", color: "GRAPHITE" },
      { name: "salud", key: null, icon_value: "tag", color: "GRAPHITE" },
    ]);
    expect(await db.styledCategories()).toEqual([
      { name: "Arriendo", icon_kind: "SYMBOL", icon_value: "key", color: "INDIGO" },
      { name: "Cine", icon_kind: "SYMBOL", icon_value: "tv", color: "PLUM" },
      { name: "Farmacia", icon_kind: "SYMBOL", icon_value: "pill", color: "ROSE" },
      { name: "Gasolina", icon_kind: "SYMBOL", icon_value: "fuel", color: "STEEL" },
      { name: "Gimnasio", icon_kind: "SYMBOL", icon_value: "heart", color: "ROSE" },
      { name: "Mantenimiento", icon_kind: "SYMBOL", icon_value: "wrench", color: "INDIGO" },
      { name: "Mercado", icon_kind: "SYMBOL", icon_value: "cart", color: "SAND" },
      { name: "Otros ingresos", icon_kind: "SYMBOL", icon_value: "gift", color: "PINE" },
      { name: "Panadería", icon_kind: "SYMBOL", icon_value: "apple", color: "SAND" },
      { name: "Restaurantes", icon_kind: "SYMBOL", icon_value: "fork", color: "SAND" },
      { name: "Salario", icon_kind: "SYMBOL", icon_value: "briefcase", color: "PINE" },
      { name: "Servicios", icon_kind: "SYMBOL", icon_value: "bulb", color: "INDIGO" },
      { name: "Verduras", icon_kind: null, icon_value: null, color: null },
      { name: "Veterinario", icon_kind: "SYMBOL", icon_value: "tag", color: "GRAPHITE" },
      { name: "Viajes", icon_kind: "SYMBOL", icon_value: "plane", color: "PLUM" },
    ]);
  });

  it("styles a top-level category whose key is outside the catalog with its group's style", async () => {
    const db = await openDatabase(before);
    const casa = await db.group("Casa", 1);
    const taller = await db.group("Taller", 2);
    await db.category(casa, "Arriendo", "rent");
    await db.category(casa, "Servicios", "utilities");
    const rara = await db.category(casa, "Rara", "legacy_x");
    await db.category(taller, "Otra", "legacy_y");
    // A subcategory takes no style, whatever its key: an unknown one, or a catalog key no top-level category holds.
    await db.category(casa, "Hija", "legacy_z", { parent: rara });
    await db.category(casa, "Hija2", "travel", { parent: rara });
    await runMigrations(db.url);
    expect(await db.styledCategories()).toEqual([
      { name: "Arriendo", icon_kind: "SYMBOL", icon_value: "key", color: "INDIGO" },
      { name: "Hija", icon_kind: null, icon_value: null, color: null },
      { name: "Hija2", icon_kind: null, icon_value: null, color: null },
      // "Taller" is keyless: its category holds the column defaults.
      { name: "Otra", icon_kind: "SYMBOL", icon_value: "tag", color: "GRAPHITE" },
      // "Casa" is the housing group (2 housing categories against the subcategory's 1 leisure one): its category
      // takes the group's style, not a catalog style for an unknown key.
      { name: "Rara", icon_kind: "SYMBOL", icon_value: "home", color: "INDIGO" },
      { name: "Servicios", icon_kind: "SYMBOL", icon_value: "bulb", color: "INDIGO" },
    ]);
  });

  it("keys the groups of each space on their own, so a key held in one space is still free in another", async () => {
    const db = await openDatabase(before);
    const other = await db.newSpace();
    // The first space: "Casa" holds the most of housing (2) and "Despensa" all of food.
    const casa = await db.group("Casa", 2);
    const despensa = await db.group("Despensa", 3);
    await db.group("Salud", 4);
    await db.category(casa, "Arriendo", "rent");
    await db.category(casa, "Servicios", "utilities");
    await db.category(despensa, "Mercado", "groceries");
    // The other space competes for the same keys: its "Casa" holds less housing (1) than the first space's, and its
    // "Alimentación" and "Salud" match names by the name only, "Salud" being older than the first space's.
    const otherCasa = await other.group("Casa", 5);
    await other.group("Alimentación", 6);
    await other.group("Salud", 1);
    await other.category(otherCasa, "Arriendo", "rent");
    await runMigrations(db.url);
    expect(await db.styledGroups()).toEqual([
      { name: "Casa", key: "housing", icon_value: "home", color: "INDIGO" },
      { name: "Despensa", key: "food", icon_value: "apple", color: "SAND" },
      { name: "Salud", key: "health", icon_value: "heart", color: "ROSE" },
    ]);
    expect(await other.styledGroups()).toEqual([
      { name: "Alimentación", key: "food", icon_value: "apple", color: "SAND" },
      { name: "Casa", key: "housing", icon_value: "home", color: "INDIGO" },
      { name: "Salud", key: "health", icon_value: "heart", color: "ROSE" },
    ]);
  });

  it("gives a catalog name's key to the oldest of the keyless groups that match it", async () => {
    const db = await openDatabase(before);
    // "Salud" (es) and "Health" (en) both name the health group: only the older one takes its key.
    await db.group("Salud", 1);
    await db.group("Health", 2);
    await runMigrations(db.url);
    expect(await db.styledGroups()).toEqual([
      { name: "Health", key: null, icon_value: "tag", color: "GRAPHITE" },
      { name: "Salud", key: "health", icon_value: "heart", color: "ROSE" },
    ]);
  });

  it("changes no row and keeps a style set since when its name-key and fallback steps run again", async () => {
    const db = await openDatabase(before);
    const salud = await db.group("Salud", 1);
    const casa = await db.group("Casa", 2);
    const taller = await db.group("Taller", 3);
    // Keyless and named like a catalog group whose key "Casa" holds: a candidate the key step must still refuse.
    await db.group("Vivienda", 4);
    await db.category(casa, "Arriendo", "rent");
    await db.category(salud, "Chequeo", null);
    await db.category(taller, "Snacks", null);
    await runMigrations(db.url);
    // The back-fill ran once; afterwards the user restyles a category the fallback had styled.
    await db.client.query(
      `UPDATE categories SET icon_kind = 'EMOJI', icon_value = $2, color = 'ROSE' WHERE space_id = $1 AND name = 'Snacks'`,
      [db.space, "🍞"],
    );
    const snapshot = async () => ({
      groups: await db.rows(`SELECT * FROM category_groups WHERE space_id = $1 ORDER BY id`),
      categories: await db.rows(`SELECT * FROM categories WHERE space_id = $1 ORDER BY id`),
    });
    const settled = await snapshot();
    // Step 1 rewrites the same group keys, and step 3 and step 4's by-key statement write the catalog's styles again,
    // which would undo a restyle: the journal runs 0017 once, so none of them is run twice. The two statements below
    // only fill what is still missing.
    const steps = {
      "step 2, the key by name": backfillStatement('u."name" IN (d."es", d."en")'),
      "step 4, the fallback to the group's style": backfillStatement('SET "icon_kind" = g."icon_kind"'),
    };
    for (const [name, statement] of Object.entries(steps)) {
      expect((await db.client.query(statement)).rowCount, name).toBe(0);
    }
    expect(await snapshot()).toEqual(settled);
    expect(
      await db.rows(`SELECT name, key FROM category_groups WHERE space_id = $1 ORDER BY name COLLATE "C"`),
    ).toEqual([
      { name: "Casa", key: "housing" },
      { name: "Salud", key: "health" },
      { name: "Taller", key: null },
      { name: "Vivienda", key: null },
    ]);
    expect(await db.styledCategories()).toEqual([
      { name: "Arriendo", icon_kind: "SYMBOL", icon_value: "key", color: "INDIGO" },
      { name: "Chequeo", icon_kind: "SYMBOL", icon_value: "heart", color: "ROSE" },
      { name: "Snacks", icon_kind: "EMOJI", icon_value: "🍞", color: "ROSE" },
    ]);
  });

  it("repeats the seed's group keys, names, styles and category keys, so the back-fill and the seed never drift", () => {
    const sql = readFileSync(`drizzle/${TAG}.sql`, "utf8");
    // Every `(VALUES …) AS d (columns)` list of the back-fill, by its column names.
    const lists = new Map<string, string[][]>();
    for (const match of sql.matchAll(/\(VALUES\s+([\s\S]*?)\s*\) AS d \(([^)]*)\)/g)) {
      const columns = match[2]!.split(",").map((column) => column.trim().replaceAll('"', ""));
      const tuples = [...match[1]!.matchAll(/\(([^()]*)\)/g)].map((tuple) =>
        tuple[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, "")),
      );
      lists.set(columns.join(","), tuples);
    }
    const groups = DEFAULT_CATALOG.map((group, index) => ({ ...group, position: String(index + 1) }));
    const categories = groups.flatMap((group) =>
      group.categories.map((category) => ({ ...category, group })),
    );
    expect([...lists.keys()].sort()).toEqual([
      "category_key,group_key,position",
      "category_key,icon,color",
      "group_key,es,en",
      "group_key,icon,color",
    ]);
    expect(lists.get("category_key,group_key,position")).toEqual(
      categories.map((c) => [c.key, c.group.key, c.group.position]),
    );
    expect(lists.get("group_key,es,en")).toEqual(groups.map((g) => [g.key, g.names.es, g.names.en]));
    expect(lists.get("group_key,icon,color")).toEqual(groups.map((g) => [g.key, g.icon, g.color]));
    expect(lists.get("category_key,icon,color")).toEqual(
      categories.map((c) => [c.key, c.icon, c.group.color]),
    );
  });
});

describe("categories_style_whole (HU-E3-05, ruling P57)", () => {
  let db: Awaited<ReturnType<typeof openDatabase>>;
  let group: string;
  let parent: string;

  /** A raw insert, so a style the repository could never write reaches the table. */
  const insert = (parentId: string | null, name: string, style: (string | null)[]) =>
    db.client.query<{ id: string }>(
      `INSERT INTO categories (id, space_id, group_id, parent_category_id, name, icon_kind, icon_value, color, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
      [db.space, group, parentId, name, ...style],
    );

  beforeAll(async () => {
    db = await openDatabase("drizzle");
    group = await db.group("Casa", 1);
    parent = (await insert(null, "Arriendo", ["SYMBOL", "key", "INDIGO"])).rows[0]!.id;
  });

  it("accepts a top-level category with a whole style and a subcategory with none", async () => {
    await expect(insert(null, "Servicios", ["SYMBOL", "bulb", "INDIGO"])).resolves.toMatchObject({
      rowCount: 1,
    });
    await expect(insert(parent, "Verduras", [null, null, null])).resolves.toMatchObject({ rowCount: 1 });
  });

  it.each([
    {
      half: "an icon kind and a color without the icon",
      onSubcategory: false,
      style: ["SYMBOL", null, "INDIGO"],
    },
    { half: "an icon without a color", onSubcategory: true, style: ["SYMBOL", "key", null] },
    { half: "an icon kind alone", onSubcategory: true, style: ["SYMBOL", null, null] },
  ])("refuses a category with $half", async ({ half, onSubcategory, style }) => {
    await expect(insert(onSubcategory ? parent : null, half, style)).rejects.toMatchObject({
      code: "23514",
      constraint: "categories_style_whole",
    });
  });
});
