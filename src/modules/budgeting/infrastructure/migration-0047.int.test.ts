import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0047_p342_plan_currencies";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0047: plans with one planned amount, capacity and value per line. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0047-"));
/** Every database a test opened, registered before it is migrated so `afterAll` always drops it. */
const databases: { name: string; client?: pg.Client }[] = [];
const rollbackSql = () => readFileSync(join("drizzle", "rollback", "0047_down.sql"), "utf8");

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
  if (failures.length > 0) throw new AggregateError(failures, "Cleaning up the 0047 test databases failed");
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

/**
 * The shape before 0047: Household (COP) and Trip (USD), each with a plan. Household plans Home 1.470.000 COP (FIXED,
 * one superseded value), Free 730.000 COP (PERCENT) and a removed line; Ana and Juan contribute in COP. Trip plans
 * Food 300 USD with Ana's 300 USD.
 */
async function seedPlans(client: pg.Client) {
  const space = async (name: string, currency: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at) VALUES ($1, $2, 'SHARED', $3, '{}', now())`,
      [id, name, currency],
    );
    return id;
  };
  const member = async (spaceId: string, name: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO space_members (id, space_id, kind, display_name, joined_at) VALUES ($1, $2, 'GUEST', $3, now())`,
      [id, spaceId, name],
    );
    return id;
  };
  const plan = async (spaceId: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_by, created_at, updated_at)
       VALUES ($1, $2, '2026-11', '2026-11-01', '2026-11-30', 'DRAFT', 'u-ana', now(), now())`,
      [id, spaceId],
    );
    return id;
  };
  const line = async (planId: string, name: string, planned: bigint, rule: string, deleted = false) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
         is_catch_all, allocation_rule, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, 'DIRECT', '{}', 'RESET', false, $5, now(), now(), $6)`,
      [id, planId, name, planned.toString(), rule, deleted ? new Date() : null],
    );
    return id;
  };
  const capacity = (planId: string, memberId: string, amount: bigint) =>
    client.query(
      `INSERT INTO budget_member_capacities (plan_id, member_id, amount, updated_at) VALUES ($1, $2, $3, now())`,
      [planId, memberId, amount.toString()],
    );
  const value = (lineId: string, memberId: string, rule: string, amount: bigint, superseded = false) =>
    client.query(
      `INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at, superseded_at)
       VALUES ($1, $2, $3, $4, now(), $5)`,
      [lineId, memberId, rule, amount.toString(), superseded ? new Date() : null],
    );
  const household = await space("Casa", "COP");
  const trip = await space("Viaje", "USD");
  const [ana, juan] = [await member(household, "Ana"), await member(household, "Juan")];
  const tripAna = await member(trip, "Ana");
  const november = await plan(household);
  const tripPlan = await plan(trip);
  const home = await line(november, "Home", 147_000_000n, "FIXED");
  const free = await line(november, "Free", 73_000_000n, "PERCENT");
  const gone = await line(november, "Gone", 5_000n, "PROPORTIONAL", true);
  const food = await line(tripPlan, "Food", 30_000n, "PROPORTIONAL");
  await capacity(november, ana, 160_000_000n);
  await capacity(november, juan, 240_000_000n);
  await capacity(tripPlan, tripAna, 30_000n);
  await value(home, ana, "FIXED", 1n, true);
  await value(home, ana, "FIXED", 47_000_000n);
  await value(home, juan, "FIXED", 100_000_000n);
  await value(free, ana, "PERCENT", 4200n);
  await value(free, juan, "PERCENT", 5800n);
  return { household, november, tripPlan, home, free, gone, food, ana, juan };
}

/** What a reader of plans sees, in a stable order. */
const budgets = async (client: pg.Client) =>
  (
    await client.query(
      `SELECT line_id, currency, planned_amount::text AS amount, position, removed_at FROM budget_line_budgets
       ORDER BY line_id, currency`,
    )
  ).rows;
const capacities = async (client: pg.Client, withCurrency: boolean) =>
  (
    await client.query(
      `SELECT plan_id, member_id, ${withCurrency ? "currency, " : ""}amount::text AS amount
       FROM budget_member_capacities ORDER BY plan_id, member_id`,
    )
  ).rows;
const values = async (client: pg.Client, withCurrency: boolean) =>
  (
    await client.query(
      `SELECT line_id, member_id, rule, ${withCurrency ? "currency, " : ""}value::text AS value,
         superseded_at IS NOT NULL AS superseded
       FROM budget_allocations ORDER BY line_id, member_id, value`,
    )
  ).rows;
const plannedAmounts = async (client: pg.Client) =>
  (await client.query(`SELECT id, planned_amount::text AS planned FROM budget_lines ORDER BY id`)).rows;

describe(`${TAG} (P342 S7, #341)`, () => {
  it("turns every planned amount, capacity and FIXED value into a row in its space's currency, converting nothing", async () => {
    const db = await openDatabase(before);
    const w = await seedPlans(db.client);
    const planned = await plannedAmounts(db.client);
    const values0 = await values(db.client, false);
    await runMigrations(db.url, "drizzle");

    const byLine = (lineId: string, currency: string, amount: string) =>
      expect.objectContaining({ line_id: lineId, currency, amount, position: 0, removed_at: null });
    expect(await budgets(db.client)).toEqual(
      expect.arrayContaining([
        byLine(w.home, "COP", "147000000"),
        byLine(w.free, "COP", "73000000"),
        // A removed line keeps its planned amount too (D8).
        byLine(w.gone, "COP", "5000"),
        byLine(w.food, "USD", "30000"),
      ]),
    );
    expect(await budgets(db.client)).toHaveLength(4);
    // The old column keeps its values for the rollback.
    expect(await plannedAmounts(db.client)).toEqual(planned);
    expect(await capacities(db.client, true)).toEqual(
      expect.arrayContaining([
        { plan_id: w.november, member_id: w.ana, currency: "COP", amount: "160000000" },
        { plan_id: w.november, member_id: w.juan, currency: "COP", amount: "240000000" },
        expect.objectContaining({ plan_id: w.tripPlan, currency: "USD", amount: "30000" }),
      ]),
    );
    const migrated = await values(db.client, true);
    expect(migrated.map((row) => ({ ...row, currency: undefined }))).toEqual(
      values0.map((row) => ({ ...row, currency: undefined })),
    );
    expect(migrated.map((v) => [v.rule, v.currency])).toEqual(
      expect.arrayContaining([
        ["FIXED", "COP"],
        ["PERCENT", null],
      ]),
    );
    expect(migrated.filter((v) => v.rule === "FIXED").every((v) => v.currency === "COP")).toBe(true);
    expect(migrated.filter((v) => v.rule === "PERCENT").every((v) => v.currency === null)).toBe(true);
  });

  it("is undone by its rollback while every plan keeps one currency, and applies again after it", async () => {
    const db = await openDatabase(before);
    const w = await seedPlans(db.client);
    const planned = await plannedAmounts(db.client);
    const capacities0 = await capacities(db.client, false);
    const values0 = await values(db.client, false);
    await runMigrations(db.url, "drizzle");
    // After 0047 Home becomes 1.500.000 COP: the rollback gives the old column the current budget.
    await db.client.query(`UPDATE budget_line_budgets SET planned_amount = 150000000 WHERE line_id = $1`, [
      w.home,
    ]);
    const applied = await db.client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);

    await db.client.query(rollbackSql());
    expect(await plannedAmounts(db.client)).toEqual(
      planned.map((row) => (row.id === w.home ? { ...row, planned: "150000000" } : row)),
    );
    expect(await capacities(db.client, false)).toEqual(capacities0);
    expect(await values(db.client, false)).toEqual(values0);
    // Nothing is dropped: the budgets stay in a backup table.
    expect(
      (await db.client.query(`SELECT count(*)::int AS n FROM p342_s7_line_budgets_backup`)).rows[0],
    ).toEqual({ n: 4 });
    expect((await db.client.query(`SELECT to_regclass('public.budget_line_budgets') AS t`)).rows[0]).toEqual({
      t: null,
    });
    expect(
      (await db.client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows[0],
    ).toEqual({ n: (applied.rows[0] as { n: number }).n - 1 });

    // A later deploy applies 0047 again, from the restored column.
    await db.client.query(`ALTER TABLE p342_s7_line_budgets_backup RENAME TO p342_s7_line_budgets_first`);
    await runMigrations(db.url, "drizzle");
    expect(await budgets(db.client)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line_id: w.home, currency: "COP", amount: "150000000" }),
      ]),
    );
  });

  it("refuses to roll back, changing nothing, once a plan holds an amount in another currency than its space's", async () => {
    const db = await openDatabase(before);
    const w = await seedPlans(db.client);
    await runMigrations(db.url, "drizzle");
    await db.client.query(
      `INSERT INTO budget_line_budgets (plan_id, line_id, currency, planned_amount, position, created_at, updated_at)
       VALUES ($1, $2, 'USD', 10000, 1, now(), now())`,
      [w.november, w.free],
    );
    await db.client.query(
      `INSERT INTO budget_member_capacities (plan_id, member_id, currency, amount, updated_at)
       VALUES ($1, $2, 'USD', 10000, now())`,
      [w.november, w.juan],
    );
    const beforeRollback = [
      await budgets(db.client),
      await capacities(db.client, true),
      await values(db.client, true),
    ];
    await expect(db.client.query(rollbackSql())).rejects.toThrow(/1 lines, 1 capacities and 0 FIXED values/);
    await db.client.query("ROLLBACK");
    expect([
      await budgets(db.client),
      await capacities(db.client, true),
      await values(db.client, true),
    ]).toEqual(beforeRollback);
  });
});
