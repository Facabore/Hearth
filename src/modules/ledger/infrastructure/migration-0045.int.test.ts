import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Money } from "@/shared/kernel";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const TAG = "0045_p342_own_currency";
const ACTOR = "system:migration-0045";
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
/** A copy of drizzle/ whose journal stops before 0045: the 0044 shape, where a foreign movement kept a base amount. */
const before = mkdtempSync(join(tmpdir(), "hearth-before-0045-"));
/**
 * A copy of drizzle/ whose journal stops at 0045, for its rollback: the migrator applies only migrations newer than the
 * last one applied, so a later migration (P343's 0046) still applied would keep a rolled-back 0045 from applying again.
 */
const through = mkdtempSync(join(tmpdir(), "hearth-through-0045-"));
/** Every database a test opened, registered before it is migrated so `afterAll` always drops it. */
const databases: { name: string; client?: pg.Client }[] = [];
const migrationSql = () => readFileSync(join("drizzle", `${TAG}.sql`), "utf8");

beforeAll(async () => {
  await admin.connect();
  cpSync("drizzle", before, { recursive: true });
  const journalFile = join(before, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const cut = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(cut).toBeGreaterThan(0);
  writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }));
  cpSync("drizzle", through, { recursive: true });
  writeFileSync(
    join(through, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }),
  );
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
  await attempt(() => rmSync(through, { recursive: true, force: true }));
  if (failures.length > 0) throw new AggregateError(failures, "Cleaning up the 0045 test databases failed");
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

/** A COP space with three guests, a category and shared-fund accounts in COP, USD and EUR (no user rows needed). */
async function seedWorld(client: pg.Client) {
  const space = randomUUID();
  await client.query(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, created_at)
     VALUES ($1, 'Casa', 'SHARED', 'COP', '{}', now())`,
    [space],
  );
  const member = async (name: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO space_members (id, space_id, kind, display_name, joined_at) VALUES ($1, $2, 'GUEST', $3, now())`,
      [id, space, name],
    );
    return id;
  };
  const account = async (name: string, currency: string) => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, currency, created_at)
       VALUES ($1, $2, $3, 'SHARED_FUND', NULL, 0, $4, now())`,
      [id, space, name, currency],
    );
    return id;
  };
  const group = randomUUID();
  await client.query(
    `INSERT INTO category_groups (id, space_id, name, position, created_at) VALUES ($1, $2, 'Hogar', 0, now())`,
    [group, space],
  );
  const category = randomUUID();
  await client.query(
    `INSERT INTO categories (id, space_id, group_id, name, icon_kind, icon_value, color, created_at)
     VALUES ($1, $2, $3, 'Mercado', 'SYMBOL', 'tag', 'GRAPHITE', now())`,
    [category, space, group],
  );
  return {
    space,
    category,
    ana: await member("Ana"),
    beto: await member("Beto"),
    caro: await member("Caro"),
    cop: await account("Fondo pesos", "COP"),
    usd: await account("Fondo dólares", "USD"),
    eur: await account("Fondo euros", "EUR"),
  };
}
type World = Awaited<ReturnType<typeof seedWorld>>;

interface Row {
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT" | "ADJUSTMENT";
  readonly amount: bigint;
  readonly currency?: string;
  readonly original?: readonly [bigint, string];
  readonly source?: { readonly account: string; readonly leg?: readonly [bigint, string] };
  readonly destination?: { readonly account: string; readonly leg?: readonly [bigint, string | null] };
  readonly receiving?: string;
  readonly deleted?: boolean;
  readonly payments?: readonly { member?: string; account?: string; amount: bigint; leg?: bigint }[];
  readonly shares?: readonly { member: string; amount: bigint; method: string }[];
}

/** One movement in the 0044 shape, with its payments and shares, by raw SQL. */
async function insertRow(client: pg.Client, w: World, row: Row): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, original_amount,
       original_currency, source_account_id, source_amount, source_currency, destination_account_id,
       destination_amount, destination_currency, receiving_member_id, created_by, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, 'Movimiento', '2026-10-05', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'user-1',
       '2026-10-05T12:00:00Z', '2026-10-05T12:00:00Z', $16)`,
    [
      id,
      w.space,
      row.type,
      row.type === "EXPENSE" || row.type === "INCOME" ? w.category : null,
      row.amount,
      row.currency ?? "COP",
      row.original?.[0] ?? null,
      row.original?.[1] ?? null,
      row.source?.account ?? null,
      row.source?.leg?.[0] ?? null,
      row.source?.leg?.[1] ?? null,
      row.destination?.account ?? null,
      row.destination?.leg?.[0] ?? null,
      row.destination?.leg?.[1] ?? null,
      row.receiving ?? null,
      row.deleted === true ? "2026-10-06T12:00:00Z" : null,
    ],
  );
  for (const [position, p] of (row.payments ?? []).entries()) {
    await client.query(
      `INSERT INTO payments (transaction_id, position, member_id, account_id, amount, account_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, position, p.member ?? null, p.account ?? null, p.amount, p.leg ?? null],
    );
  }
  for (const [position, s] of (row.shares ?? []).entries()) {
    await client.query(
      `INSERT INTO shares (transaction_id, position, member_id, amount, split_method) VALUES ($1, $2, $3, $4, $5)`,
      [id, position, s.member, s.amount, s.method],
    );
  }
  return id;
}

/** `netMovements`' figure (drizzle-ledger-queries.ts) per account, live and deleted rows apart. */
const nets = async (client: pg.Client) =>
  (
    await client.query<{ account: string; live: boolean; net: string }>(
      `SELECT account, live, sum(moved)::text AS net FROM (
         SELECT destination_account_id AS account, deleted_at IS NULL AS live,
                coalesce(destination_amount, amount) AS moved
           FROM transactions WHERE destination_account_id IS NOT NULL
         UNION ALL
         SELECT source_account_id, deleted_at IS NULL, -coalesce(source_amount, amount)
           FROM transactions WHERE source_account_id IS NOT NULL
         UNION ALL
         SELECT p.account_id, t.deleted_at IS NULL, -coalesce(p.account_amount, p.amount)
           FROM payments p JOIN transactions t ON t.id = p.transaction_id WHERE p.account_id IS NOT NULL
       ) m GROUP BY account, live ORDER BY account, live`,
    )
  ).rows;

const transaction = async (client: pg.Client, id: string) =>
  (
    await client.query<Record<string, string | number | null>>(
      `SELECT amount::text, currency, original_amount::text, original_currency, source_amount::text, source_currency,
              destination_amount::text, destination_currency, version, deleted_at IS NOT NULL AS deleted
         FROM transactions WHERE id = $1`,
      [id],
    )
  ).rows[0];
const paymentsOf = async (client: pg.Client, id: string) =>
  (
    await client.query<{ amount: string; leg: string | null }>(
      `SELECT amount::text, account_amount::text AS leg FROM payments WHERE transaction_id = $1 ORDER BY position`,
      [id],
    )
  ).rows;
const sharesOf = async (client: pg.Client, id: string) =>
  (
    await client.query<{ amount: string }>(
      `SELECT amount::text FROM shares WHERE transaction_id = $1 ORDER BY position`,
      [id],
    )
  ).rows.map((s) => s.amount);
const auditsOf = async (client: pg.Client, id: string) =>
  (
    await client.query<{
      action: string;
      actor: string;
      changes: Record<string, { from: string | null; to: string | null }>;
    }>(`SELECT action, actor_user_id AS actor, changes FROM transaction_audit WHERE transaction_id = $1`, [
      id,
    ])
  ).rows;
/** Every row of the four tables the migration touches, as text, to prove a second run changes nothing. */
const everything = async (client: pg.Client) => {
  const dump = async (table: string, order: string) =>
    (await client.query<{ row: string }>(`SELECT to_jsonb(x)::text AS row FROM ${table} x ORDER BY ${order}`))
      .rows;
  return {
    transactions: await dump("transactions", "id"),
    payments: await dump("payments", "transaction_id, position"),
    shares: await dump("shares", "transaction_id, position"),
    audit: await dump("transaction_audit", "id"),
    backup: await dump("p342_s8_backup", "transaction_id"),
  };
};

describe(`${TAG} (P342 S8, #341)`, () => {
  it("brings every converted movement back to its original currency, keeping each account's figure", async () => {
    const db = await openDatabase(before);
    const w = await seedWorld(db.client);
    // 100 USD charged, kept as 400.000 COP, paid from the COP fund (no leg: the fund moved the base amount).
    const fromCop = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      payments: [{ member: w.ana, account: w.cop, amount: 40_000_000n }],
      shares: [{ member: w.ana, amount: 40_000_000n, method: "EQUAL" }],
    });
    // The same, paid from the USD fund, whose leg is what it moved in dollars.
    const fromUsd = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      payments: [{ member: w.ana, account: w.usd, amount: 40_000_000n, leg: 10_000n }],
      shares: [{ member: w.beto, amount: 40_000_000n, method: "EQUAL" }],
    });
    // 25 USD as 100.000 COP split three ways in whole pesos (33.334 / 33.333 / 33.333).
    const threeWay = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 10_000_000n,
      original: [2_500n, "USD"],
      payments: [{ member: w.ana, account: w.cop, amount: 10_000_000n }],
      shares: [
        { member: w.ana, amount: 3_333_400n, method: "EQUAL" },
        { member: w.beto, amount: 3_333_300n, method: "EQUAL" },
        { member: w.caro, amount: 3_333_300n, method: "EQUAL" },
      ],
    });
    // 10 USD as 40.000 COP, paid 6 USD from the USD fund and 16.000 COP from the COP fund, split 3:1 exactly.
    const twoPayments = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 4_000_000n,
      original: [1_000n, "USD"],
      payments: [
        { member: w.ana, account: w.usd, amount: 2_400_000n, leg: 600n },
        { member: w.beto, account: w.cop, amount: 1_600_000n },
      ],
      shares: [
        { member: w.ana, amount: 3_000_000n, method: "EXACT" },
        { member: w.beto, amount: 1_000_000n, method: "EXACT" },
      ],
    });
    const deleted = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      deleted: true,
      payments: [{ member: w.caro, account: w.cop, amount: 40_000_000n }],
      shares: [{ member: w.caro, amount: 40_000_000n, method: "EQUAL" }],
    });
    // 50 EUR received as 220.000 COP into the USD fund (54 USD); its leg's currency was never stored (legacy).
    const income = await insertRow(db.client, w, {
      type: "INCOME",
      amount: 22_000_000n,
      original: [5_000n, "EUR"],
      receiving: w.ana,
      destination: { account: w.usd, leg: [5_400n, null] },
    });
    // 100.000 COP received into the USD fund (25 USD), no original: only the leg's currency is filled in.
    const legacyIncome = await insertRow(db.client, w, {
      type: "INCOME",
      amount: 10_000_000n,
      receiving: w.beto,
      destination: { account: w.usd, leg: [2_500n, null] },
    });
    // 100 USD moved from the USD fund to the COP fund, kept as 400.000 COP with a USD "Sale".
    const transfer = await insertRow(db.client, w, {
      type: "TRANSFER",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      source: { account: w.usd, leg: [10_000n, "USD"] },
      destination: { account: w.cop },
    });
    const pesos = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 5_000_000n,
      payments: [{ member: w.ana, account: w.cop, amount: 5_000_000n }],
      shares: [
        { member: w.ana, amount: 2_500_000n, method: "EQUAL" },
        { member: w.beto, amount: 2_500_000n, method: "EQUAL" },
      ],
    });
    const netsBefore = await nets(db.client);
    const pesosBefore = await transaction(db.client, pesos);

    // The owner's dry run reads this world as convertible: the preconditions and the would-RAISE queries find nothing.
    const dryRun = (await db.client.query(
      readFileSync(join("scripts", "p342-dry-run.sql"), "utf8"),
    )) as unknown as { rows: Record<string, unknown>[] }[];
    const [, affected, legacy, splits, payments, legs, sides, expenses, ownLegs] = dryRun;
    expect(affected?.rows.reduce((sum, row) => sum + Number(row.movements), 0)).toBe(7);
    expect(legacy?.rows.reduce((sum, row) => sum + Number(row.incomes), 0)).toBe(2);
    expect(splits?.rows[0]).toEqual({ multi_payment: "1", multi_share: "2", not_equal_split: "1" });
    expect(payments?.rows[0]).toEqual({ payments_without_leg_in_another_currency: "0" });
    expect(legs?.rows[0]).toEqual({ legs_missing_in_another_currency: "0" });
    expect(sides?.rows).toEqual([]);
    expect(expenses?.rows).toEqual([]);
    expect(ownLegs?.rows[0]).toEqual({ legs_in_own_currency: "0" });

    await runMigrations(db.url, "drizzle");

    expect(await transaction(db.client, fromCop)).toMatchObject({
      amount: "10000",
      currency: "USD",
      original_amount: null,
      original_currency: null,
      version: 2,
    });
    expect(await paymentsOf(db.client, fromCop)).toEqual([{ amount: "10000", leg: "40000000" }]);
    expect(await sharesOf(db.client, fromCop)).toEqual(["10000"]);

    expect(await transaction(db.client, fromUsd)).toMatchObject({ amount: "10000", currency: "USD" });
    expect(await paymentsOf(db.client, fromUsd)).toEqual([{ amount: "10000", leg: null }]);
    expect(await sharesOf(db.client, fromUsd)).toEqual(["10000"]);

    expect(await transaction(db.client, threeWay)).toMatchObject({ amount: "2500", currency: "USD" });
    expect(await paymentsOf(db.client, threeWay)).toEqual([{ amount: "2500", leg: "10000000" }]);
    expect(await sharesOf(db.client, threeWay)).toEqual(["834", "833", "833"]);

    expect(await transaction(db.client, twoPayments)).toMatchObject({ amount: "1000", currency: "USD" });
    expect(await paymentsOf(db.client, twoPayments)).toEqual([
      { amount: "600", leg: null },
      { amount: "400", leg: "1600000" },
    ]);
    expect(await sharesOf(db.client, twoPayments)).toEqual(["750", "250"]);

    expect(await transaction(db.client, deleted)).toMatchObject({
      amount: "10000",
      currency: "USD",
      deleted: true,
    });
    expect(await paymentsOf(db.client, deleted)).toEqual([{ amount: "10000", leg: "40000000" }]);

    expect(await transaction(db.client, income)).toMatchObject({
      amount: "5000",
      currency: "EUR",
      original_amount: null,
      destination_amount: "5400",
      destination_currency: "USD",
    });
    expect(await transaction(db.client, legacyIncome)).toMatchObject({
      amount: "10000000",
      currency: "COP",
      destination_amount: "2500",
      destination_currency: "USD",
    });
    expect(await transaction(db.client, transfer)).toMatchObject({
      amount: "10000",
      currency: "USD",
      source_amount: null,
      source_currency: null,
      destination_amount: "40000000",
      destination_currency: "COP",
    });

    expect(await transaction(db.client, pesos)).toEqual(pesosBefore);
    expect(await auditsOf(db.client, pesos)).toEqual([]);
    expect(await nets(db.client)).toEqual(netsBefore);

    const converted = [fromCop, fromUsd, threeWay, twoPayments, deleted, income, legacyIncome, transfer];
    for (const id of converted) {
      const audits = await auditsOf(db.client, id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "UPDATED",
        actor: ACTOR,
        changes: { migration: { from: null, to: "0045" } },
      });
    }
    expect((await auditsOf(db.client, fromCop))[0]?.changes).toEqual({
      migration: { from: null, to: "0045" },
      amount: { from: "40000000", to: "10000" },
      currency: { from: "COP", to: "USD" },
      originalAmount: { from: "10000 USD", to: null },
      payments: {
        from: JSON.stringify([{ memberId: w.ana, accountId: w.cop, amount: "40000000" }]),
        to: JSON.stringify([
          { memberId: w.ana, accountId: w.cop, amount: "10000", accountAmount: "40000000 COP" },
        ]),
      },
      shares: {
        from: JSON.stringify([{ memberId: w.ana, amount: "40000000", splitMethod: "EQUAL" }]),
        to: JSON.stringify([{ memberId: w.ana, amount: "10000", splitMethod: "EQUAL" }]),
      },
    });
    expect((await auditsOf(db.client, legacyIncome))[0]?.changes).toEqual({
      migration: { from: null, to: "0045" },
      destinationAmount: { from: "2500 COP", to: "2500 USD" },
    });

    const backup = await db.client.query<{
      id: string;
      tx: { amount: number; original_amount: number | null };
    }>(`SELECT transaction_id AS id, "transaction" AS tx FROM p342_s8_backup`);
    expect(backup.rows.map((r) => r.id).sort()).toEqual([...converted].sort());
    const fromCopBackup = backup.rows.find((r) => r.id === fromCop)!;
    expect(fromCopBackup.tx).toMatchObject({ amount: 40_000_000, original_amount: 10_000 });

    // Re-running the file changes nothing: no row has an original left, so nothing is converted, audited or backed up.
    const once = await everything(db.client);
    await db.client.query(migrationSql());
    expect(await everything(db.client)).toEqual(once);
  });

  it("aborts and changes nothing when an account's figure could not be kept", async () => {
    const db = await openDatabase(before);
    const w = await seedWorld(db.client);
    // The USD fund's "Sale" says 99,99 USD, but the original is 100 USD: amount := original would move it by 100.
    await insertRow(db.client, w, {
      type: "TRANSFER",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      source: { account: w.usd, leg: [9_999n, "USD"] },
      destination: { account: w.cop },
    });
    const untouched = await everythingBefore(db.client);
    await expect(runMigrations(db.url, "drizzle")).rejects.toThrow(/P342 S8/);
    expect(await everythingBefore(db.client)).toEqual(untouched);
  });

  it("is undone by its rollback, which keeps the audit and lets 0045 apply again", async () => {
    const db = await openDatabase(before);
    const w = await seedWorld(db.client);
    const expense = await insertRow(db.client, w, {
      type: "EXPENSE",
      amount: 4_000_000n,
      original: [1_000n, "USD"],
      payments: [
        { member: w.ana, account: w.usd, amount: 2_400_000n, leg: 600n },
        { member: w.beto, account: w.cop, amount: 1_600_000n },
      ],
      shares: [
        { member: w.ana, amount: 3_000_000n, method: "PERCENT" },
        { member: w.beto, amount: 1_000_000n, method: "PERCENT" },
      ],
    });
    await insertRow(db.client, w, {
      type: "INCOME",
      amount: 10_000_000n,
      receiving: w.beto,
      destination: { account: w.usd, leg: [2_500n, null] },
    });
    await insertRow(db.client, w, {
      type: "TRANSFER",
      amount: 40_000_000n,
      original: [10_000n, "USD"],
      deleted: true,
      source: { account: w.usd, leg: [10_000n, "USD"] },
      destination: { account: w.cop },
    });
    const rows = await everythingBefore(db.client);
    await runMigrations(db.url, through);
    const migrated = await everything(db.client);
    const rollback = readFileSync(join("drizzle", "rollback", "0045_down.sql"), "utf8");

    await db.client.query(rollback);
    const { audit, ...restored } = await everythingBefore(db.client);
    expect({ ...restored, audit: rows.audit, backupTable: rows.backupTable }).toEqual(rows);
    expect(audit).toHaveLength(6);
    expect((await auditsOf(db.client, expense)).map((a) => a.changes.migration)).toEqual(
      expect.arrayContaining([
        { from: null, to: "0045" },
        { from: "0045", to: null },
      ]),
    );
    const applied = await db.client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    // Running it twice restores nothing more.
    const once = await everything(db.client);
    await db.client.query(rollback);
    expect(await everything(db.client)).toEqual(once);

    await runMigrations(db.url, through);
    expect(
      await db.client.query(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`),
    ).toMatchObject({
      rows: [{ n: (applied.rows[0] as { n: number }).n + 1 }],
    });
    const again = await everything(db.client);
    expect(again.transactions.length).toBe(migrated.transactions.length);
    expect(await transaction(db.client, expense)).toMatchObject({ amount: "1000", currency: "USD" });
    expect(await sharesOf(db.client, expense)).toEqual(["750", "250"]);
  });

  it("refuses a leg in the movement's own currency once it has run", async () => {
    const db = await openDatabase(before);
    const w = await seedWorld(db.client);
    await runMigrations(db.url, "drizzle");
    await expect(
      insertRow(db.client, w, {
        type: "TRANSFER",
        amount: 10_000n,
        currency: "USD",
        source: { account: w.usd, leg: [10_000n, "USD"] },
        destination: { account: w.cop, leg: [40_000_000n, "COP"] },
      }),
    ).rejects.toThrow(/transactions_source_leg_other_currency/);
    await expect(
      insertRow(db.client, w, {
        type: "INCOME",
        amount: 10_000n,
        currency: "USD",
        receiving: w.ana,
        destination: { account: w.cop, leg: [40_000_000n, null] },
      }),
    ).rejects.toThrow(/transactions_income_destination_currency/);
    await expect(
      insertRow(db.client, w, {
        type: "TRANSFER",
        amount: 40_000_000n,
        original: [10_000n, "USD"],
        source: { account: w.usd, leg: [10_000n, "USD"] },
        destination: { account: w.cop },
      }),
    ).rejects.toThrow(/transactions_no_original/);
  });
});

/** The rows a failed migration must leave as they were (0044 has no backup table yet). */
const everythingBefore = async (client: pg.Client) => {
  const dump = async (table: string, order: string) =>
    (await client.query<{ row: string }>(`SELECT to_jsonb(x)::text AS row FROM ${table} x ORDER BY ${order}`))
      .rows;
  return {
    transactions: await dump("transactions", "id"),
    payments: await dump("payments", "transaction_id, position"),
    shares: await dump("shares", "transaction_id, position"),
    audit: await dump("transaction_audit", "id"),
    backupTable: (await client.query(`SELECT to_regclass('public.p342_s8_backup') AS t`)).rows[0],
  };
};

describe(`${TAG}'s allocate`, () => {
  it("splits exactly as Money.allocate does", async () => {
    const db = await openDatabase(before);
    const create = migrationSql()
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("FUNCTION pg_temp.p342_allocate"));
    expect(create).toBeDefined();
    await db.client.query(create!);
    // A fixed-seed generator: the cases are random-looking but the same on every run.
    let seed = 0x2545f491n;
    const next = (bound: bigint) => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return (seed >> 16n) % bound;
    };
    const currencies = ["COP", "USD", "JPY", "KWD"];
    for (let i = 0; i < 400; i++) {
      const currency = currencies[Number(next(4n))]!;
      const magnitude = [100n, 10_000n, 10_000_000n, 10n ** 15n][Number(next(4n))]!;
      const total = (next(2n) === 0n ? 1n : -1n) * next(magnitude);
      const count = Number(next(6n)) + 1;
      const weights = Array.from({ length: count }, () =>
        next(3n) === 0n ? 0n : next([2n, 10n, 1_000n, 10n ** 12n][Number(next(4n))]!),
      );
      if (!weights.some((weight) => weight > 0n)) weights[0] = 1n;
      const money = Money.ofMinor(total, currency);
      if (!money.ok) throw new Error(`Bad case ${total} ${currency}`);
      const expected = money.value.allocate(weights);
      if (!expected.ok) throw new Error(`Money.allocate refused ${total} ${currency} ${weights.join(",")}`);
      const actual = await db.client.query<{ parts: string[] }>(
        `SELECT pg_temp.p342_allocate($1::bigint, $2::numeric[], $3::bigint)::text[] AS parts`,
        [total.toString(), weights.map(String), currency === "COP" ? "100" : "1"],
      );
      expect({ total, currency, weights, parts: actual.rows[0]?.parts }).toEqual({
        total,
        currency,
        weights,
        parts: expected.value.map((part) => part.minor.toString()),
      });
    }
  });
});
