import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0035_account_currency";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0035: the schema a database had before accounts carried a currency. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0035-"));
/** Every database a test opened, registered before it is migrated so `afterAll` always drops it. */
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
    throw new AggregateError(failures, "Cleaning up the account currency back-fill test databases failed");
});

async function insertSpace(client: pg.Client, currency: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
     VALUES ($1, 'Household', 'SHARED', $2, '{}', now())`,
    [id, currency],
  );
  return id;
}

/** A SHARED_FUND account (owner NULL, so no user row is needed); inserted before 0035, so without a currency. */
async function insertAccount(client: pg.Client, space: string, name: string): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, created_at)
     VALUES ($1, $2, $3, 'SHARED_FUND', NULL, 0, now())`,
    [id, space, name],
  );
  return id;
}

/** A fresh database migrated with the migrations of `folder`. */
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
  return { url: url.toString(), client };
}

const currencyOf = async (client: pg.Client, accountId: string) =>
  (await client.query<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1`, [accountId]))
    .rows[0]?.currency;

describe(`${TAG} (#324, D29)`, () => {
  it("back-fills a pre-existing account's currency from its space", async () => {
    const db = await openDatabase(before);
    const cop = await insertSpace(db.client, "COP");
    const usd = await insertSpace(db.client, "USD");
    const copAccount = await insertAccount(db.client, cop, "Fondo pesos");
    const usdAccount = await insertAccount(db.client, usd, "Dollar fund");
    await runMigrations(db.url, "drizzle");
    expect(await currencyOf(db.client, copAccount)).toBe("COP");
    expect(await currencyOf(db.client, usdAccount)).toBe("USD");
  });

  it("leaves the currency as it is when its statements run a second time", async () => {
    const db = await openDatabase(before);
    const space = await insertSpace(db.client, "EUR");
    const account = await insertAccount(db.client, space, "Euro fund");
    await runMigrations(db.url, "drizzle");
    const once = await currencyOf(db.client, account);
    const statements = readFileSync(join("drizzle", `${TAG}.sql`), "utf8")
      .split("--> statement-breakpoint")
      // The first statement adds the column; it cannot run twice. The back-fill and the NOT NULL are idempotent.
      .slice(1);
    for (const statement of statements) await db.client.query(statement);
    expect(await currencyOf(db.client, account)).toBe(once);
    expect(once).toBe("EUR");
  });
});
