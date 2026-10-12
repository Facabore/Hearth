import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };
const dbName = `m_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe("migrations", () => {
  it("apply to an empty database and are idempotent", async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(inject("adminDatabaseUrl"));
    url.pathname = `/${dbName}`;

    await runMigrations(url.toString());
    await runMigrations(url.toString());

    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    const applied = await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    const tables = await client.query("SELECT to_regclass('public.idempotency_keys') AS t");
    await client.end();
    expect(applied.rows[0].n).toBe(journal.entries.length);
    expect(tables.rows[0].t).toBe("idempotency_keys");
  });
});
