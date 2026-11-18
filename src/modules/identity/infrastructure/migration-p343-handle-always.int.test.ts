import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { parseHandle } from "../domain/handle";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0046_p343_handle_always";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before P343's migration: the shape where a handle could be null. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-p343-"));
/** Every database a test opened, registered before it is migrated so `afterAll` always drops it. */
const databases: { name: string; client?: pg.Client }[] = [];
/** The migration's statements, as drizzle runs them one by one. */
const statements = () =>
  readFileSync(join("drizzle", `${TAG}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

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
  if (failures.length > 0) throw new AggregateError(failures, "Cleaning up the P343 test databases failed");
});

/** A fresh database migrated up to just before P343. */
async function databaseBeforeP343() {
  const database: { name: string; client?: pg.Client } = { name: `m_${randomUUID().replaceAll("-", "")}` };
  databases.push(database);
  await admin.query(`CREATE DATABASE ${database.name}`);
  const url = new URL(inject("adminDatabaseUrl"));
  url.pathname = `/${database.name}`;
  await runMigrations(url.toString(), before);
  const client = new pg.Client({ connectionString: url.toString() });
  database.client = client;
  await client.connect();
  return { url: url.toString(), client };
}

/** A person as the older schema allowed: with a handle, or with none. */
const insertUser = async (client: pg.Client, name: string, handle: string | null = null) => {
  const id = randomUUID();
  await client.query(`INSERT INTO "user" (id, name, email, handle) VALUES ($1, $2, $3, $4)`, [
    id,
    name,
    `${id}@example.com`,
    handle,
  ]);
  return id;
};

const handlesOf = async (client: pg.Client): Promise<Map<string, string>> => {
  const { rows } = await client.query<{ id: string; handle: string }>(`SELECT id, handle FROM "user"`);
  return new Map(rows.map((row) => [row.id, row.handle]));
};

/** Runs the migration's statements again, in one transaction as drizzle does. */
const runAgain = async (client: pg.Client) => {
  await client.query("BEGIN");
  for (const statement of statements()) await client.query(statement);
  await client.query("COMMIT");
};

describe("migration P343: everyone has an @usuario", () => {
  it("gives each person without a handle a unique one made of their name, and keeps the chosen ones", async () => {
    const { url, client } = await databaseBeforeP343();
    const jose = await insertUser(client, "José Ñúñez");
    const alvaro = await insertUser(client, "ÁLVARO");
    const lee = await insertUser(client, "李小龙");
    const anas = [
      await insertUser(client, "Ana"),
      await insertUser(client, "Ana"),
      await insertUser(client, "Ana"),
    ];
    const bruno = await insertUser(client, "Bruno", "bruno_b");

    await runMigrations(url);

    const handles = await handlesOf(client);
    expect(handles.get(jose)).toMatch(/^josenunez_[0-9]{4}$/);
    expect(handles.get(alvaro)).toMatch(/^alvaro_[0-9]{4}$/);
    expect(handles.get(lee)).toMatch(/^hearth_[0-9]{4}$/);
    for (const ana of anas) expect(handles.get(ana)).toMatch(/^ana_[0-9]{4}$/);
    expect(handles.get(bruno)).toBe("bruno_b");
    expect(new Set(handles.values()).size).toBe(handles.size);
    for (const handle of handles.values()) expect(parseHandle(handle)).toEqual({ ok: true, value: handle });
  });

  it("makes the handle NOT NULL, and a row written without one gets a random one of its own", async () => {
    const { url, client } = await databaseBeforeP343();
    await runMigrations(url);

    const { rows } = await client.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'handle'`,
    );
    expect(rows).toEqual([{ is_nullable: "NO" }]);
    await expect(insertUser(client, "Eva", null)).rejects.toMatchObject({ code: "23502" });
    const first = randomUUID();
    const second = randomUUID();
    await client.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Eva', $2), ($3, 'Eva', $4)`, [
      first,
      `${first}@example.com`,
      second,
      `${second}@example.com`,
    ]);
    const handles = await handlesOf(client);
    expect(handles.get(first)).toMatch(/^u_[0-9a-f]{12}$/);
    expect(handles.get(second)).toMatch(/^u_[0-9a-f]{12}$/);
    expect(handles.get(first)).not.toBe(handles.get(second));
  });

  it("draws new digits when a handle is taken", async () => {
    const { client } = await databaseBeforeP343();
    // The same seed makes the migration's first draw the one taken here.
    await client.query("SELECT setseed(0.25)");
    const { rows } = await client.query<{ digits: string }>(
      `SELECT lpad((floor(random() * 10000))::int::text, 4, '0') AS digits`,
    );
    const taken = `ana_${rows[0]!.digits}`;
    const holder = await insertUser(client, "Ana", taken);
    const ana = await insertUser(client, "Ana");

    await client.query("SELECT setseed(0.25)");
    await runAgain(client);

    const handles = await handlesOf(client);
    expect(handles.get(holder)).toBe(taken);
    expect(handles.get(ana)).toMatch(/^ana_[0-9]{4}$/);
    expect(handles.get(ana)).not.toBe(taken);
  });

  it("runs again without changing anyone's handle", async () => {
    const { url, client } = await databaseBeforeP343();
    await insertUser(client, "José");
    await insertUser(client, "Ana", "ana_b");
    await runMigrations(url);
    const once = await handlesOf(client);

    await runAgain(client);

    expect(await handlesOf(client)).toEqual(once);
  });
});
