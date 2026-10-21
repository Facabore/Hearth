import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0019_account_style_vocabulary";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0019: the schema a database had before the shared vocabulary. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0019-"));
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
    throw new AggregateError(failures, "Cleaning up the style vocabulary test databases failed");
});

async function insertSpace(client: pg.Client): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
     VALUES ($1, 'Household', 'SHARED', 'COP', '{}', now())`,
    [id],
  );
  return id;
}

/** A fresh database migrated with the migrations of `folder`, holding one SHARED space. */
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
  return { url: url.toString(), client, space: await insertSpace(client) };
}

const OLD_COLORS = ["pine", "ember", "sand", "sky", "plum", "moss", "clay", "slate", "gold", "rose"];
const OLD_ICONS = [
  "banknote",
  "landmark",
  "wallet",
  "credit-card",
  "piggy-bank",
  "trending-up",
  "hand-coins",
  "circle-ellipsis",
  "users",
  "briefcase",
  "car",
  "gem",
  "gift",
  "house",
  "plane",
  "smartphone",
];

/** A SHARED_FUND account (owner NULL, so no user row is needed); `order` keeps the creation order readable. */
const insertAccount = (
  client: pg.Client,
  space: string,
  name: string,
  order: number,
  color: string | null,
  icon: string | null,
) =>
  client.query(
    `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, color, icon, created_at)
     VALUES (gen_random_uuid(), $1, $2, 'SHARED_FUND', NULL, 0, $3, $4, now() + make_interval(secs => $5))`,
    [space, name, color, icon, order],
  );

const stylesOf = async (client: pg.Client, space: string) =>
  (
    await client.query<{ color: string | null; icon: string | null }>(
      `SELECT color, icon FROM accounts WHERE space_id = $1 ORDER BY created_at`,
      [space],
    )
  ).rows.map((row) => [row.color, row.icon]);

describe(`${TAG} (#125, ruling P122)`, () => {
  it("maps every stored account color and icon to the shared vocabulary and keeps nulls", async () => {
    const db = await openDatabase(before);
    const insert = (name: string, order: number, color: string | null, icon: string | null) =>
      insertAccount(db.client, db.space, name, order, color, icon);
    for (const [i, icon] of OLD_ICONS.entries()) await insert(`Fund ${i}`, i, OLD_COLORS[i % 10]!, icon);
    await insert("Plain", 99, null, null);
    await runMigrations(db.url, "drizzle");
    expect(await stylesOf(db.client, db.space)).toEqual([
      ["PINE", "cash"],
      ["EMBER", "bank"],
      ["SAND", "wallet"],
      ["SKY", "card"],
      ["PLUM", "piggy"],
      ["SAGE", "trend"],
      ["CORAL", "coins"],
      ["STEEL", "dots"],
      ["MUSTARD", "users"],
      ["ROSE", "briefcase"],
      ["PINE", "car"],
      ["EMBER", "star"],
      ["SAND", "gift"],
      ["SKY", "home"],
      ["PLUM", "plane"],
      ["SAGE", "phone"],
      [null, null],
    ]);
  });

  it("leaves a value outside the old lists, and values already in the new vocabulary, as they are", async () => {
    const db = await openDatabase(before);
    await insertAccount(db.client, db.space, "Odd", 0, "purple", "rocket");
    await insertAccount(db.client, db.space, "Already new", 1, "GRAPHITE", "star");
    await runMigrations(db.url, "drizzle");
    expect(await stylesOf(db.client, db.space)).toEqual([
      ["purple", "rocket"],
      ["GRAPHITE", "star"],
    ]);
  });

  it("changes nothing when its statements run a second time", async () => {
    const db = await openDatabase(before);
    for (const [i, icon] of OLD_ICONS.entries())
      await insertAccount(db.client, db.space, `Fund ${i}`, i, OLD_COLORS[i % 10]!, icon);
    await insertAccount(db.client, db.space, "Plain", 99, null, null);
    await runMigrations(db.url, "drizzle");
    const once = await stylesOf(db.client, db.space);
    const statements = readFileSync(join("drizzle", `${TAG}.sql`), "utf8").split("--> statement-breakpoint");
    expect(statements).toHaveLength(2);
    for (const statement of statements) await db.client.query(statement);
    expect(await stylesOf(db.client, db.space)).toEqual(once);
    expect(once[0]).toEqual(["PINE", "cash"]);
  });
});
