import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0040_adjustment_type";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0040: the schema a database had before the ADJUSTMENT type. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0040-"));
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
  if (failures.length > 0) throw new AggregateError(failures, "Cleaning up the 0040 test databases failed");
});

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

/** A COP space with two shared funds (owner NULL, so no user row is needed). */
async function seedSpace(client: pg.Client) {
  const space = randomUUID();
  await client.query(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
     VALUES ($1, 'Household', 'SHARED', 'COP', '{}', now())`,
    [space],
  );
  const fund = async (name: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, currency, created_at)
       VALUES ($1, $2, $3, 'SHARED_FUND', NULL, 0, 'COP', now())`,
      [id, space, name],
    );
    return id;
  };
  return { space, a: await fund("Fondo"), b: await fund("Viaje") };
}

const insertMovement = (
  client: pg.Client,
  space: string,
  type: string,
  source: string | null,
  destination: string | null,
) =>
  client.query<{ id: string }>(
    `INSERT INTO transactions (id, space_id, type, description, date, amount, currency, source_account_id,
       destination_account_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'Movimiento', '2026-11-10', 500000, 'COP', $4, $5, 'u-ana', now(), now()) RETURNING id`,
    [randomUUID(), space, type, source, destination],
  );

const rowOf = async (client: pg.Client, id: string) =>
  (await client.query(`SELECT * FROM transactions WHERE id = $1`, [id])).rows[0] as Record<string, unknown>;

describe(`${TAG} (design Q4, #329)`, () => {
  it("leaves an existing transaction row exactly as it was", async () => {
    const db = await openDatabase(before);
    const { space, a, b } = await seedSpace(db.client);
    const { rows } = await insertMovement(db.client, space, "TRANSFER", a, b);
    const id = rows[0]!.id;
    const was = await rowOf(db.client, id);
    await runMigrations(db.url, "drizzle");
    expect(await rowOf(db.client, id)).toEqual(was);
  });

  it("takes an adjustment of exactly one account, and refuses one with both or neither", async () => {
    const db = await openDatabase(before);
    const { space, a, b } = await seedSpace(db.client);
    await expect(insertMovement(db.client, space, "ADJUSTMENT", null, a)).rejects.toThrow(
      /transactions_shape/,
    );
    await runMigrations(db.url, "drizzle");
    await insertMovement(db.client, space, "ADJUSTMENT", null, a);
    await insertMovement(db.client, space, "ADJUSTMENT", b, null);
    await expect(insertMovement(db.client, space, "ADJUSTMENT", a, b)).rejects.toThrow(/transactions_shape/);
    await expect(insertMovement(db.client, space, "ADJUSTMENT", null, null)).rejects.toThrow(
      /transactions_shape/,
    );
  });
});
