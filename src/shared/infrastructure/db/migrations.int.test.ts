import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runMigrations } from "../../../../scripts/migrate.mjs";

interface JournalEntry {
  readonly tag: string;
}
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: JournalEntry[] };
const admin = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
const databases: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), "hearth-migrations-"));

let connected = false;

beforeAll(async () => {
  await admin.connect();
  connected = true;
});

afterAll(async () => {
  rmSync(scratch, { recursive: true, force: true });
  if (!connected) return;
  for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

/** A new empty database on the test server; dropped after the file. */
const emptyDatabase = async (): Promise<string> => {
  const name = `m_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${name}`);
  databases.push(name);
  const url = new URL(inject("adminDatabaseUrl"));
  url.pathname = `/${name}`;
  return url.toString();
};

/** A copy of drizzle/ whose journal stops at `tag`, so a database can be left just before a later migration. */
const migrationsThrough = (tag: string): string => {
  const last = journal.entries.findIndex((entry) => entry.tag === tag);
  if (last < 0) throw new Error(`No migration ${tag}`);
  const folder = join(scratch, tag);
  cpSync("drizzle", folder, { recursive: true });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }),
  );
  return folder;
};

type Statement = [text: string, values: unknown[]];
const exec = (client: pg.Client, [text, values]: Statement) => client.query(text, values);

/** The database's own message behind a refused migration (drizzle wraps it in a "Failed query" error). */
const refusalOf = async (migrating: Promise<unknown>): Promise<string> => {
  try {
    await migrating;
  } catch (error) {
    const { cause } = error as { cause?: unknown };
    return (cause instanceof Error ? cause : (error as Error)).message;
  }
  throw new Error("The migration was not refused");
};

const appliedCount = async (client: pg.Client): Promise<number> =>
  (await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n;

describe("migrations", () => {
  it("apply to an empty database and are idempotent", async () => {
    const url = await emptyDatabase();

    await runMigrations(url);
    await runMigrations(url);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const applied = await appliedCount(client);
    const tables = await client.query("SELECT to_regclass('public.idempotency_keys') AS t");
    await client.end();
    expect(applied).toBe(journal.entries.length);
    expect(tables.rows[0].t).toBe("idempotency_keys");
  });
});

/** The rows a world needs before the #249 migrations, written as plain SQL against the older schema. */
interface World {
  readonly user: string;
  readonly personal: string;
  readonly household: string;
  readonly ana: string;
  readonly anaAtHome: string;
  readonly pedro: string;
  readonly personalCategory: string;
  readonly householdCategory: string;
  readonly bank: string;
  readonly expense: string;
  readonly settlement: string;
  readonly audit: string;
  readonly plan: string;
  readonly otherPlan: string;
  readonly line: string;
  readonly allocation: string;
  readonly claim: string;
}

const seed = async (client: pg.Client): Promise<World> => {
  const ids = {
    personal: randomUUID(),
    household: randomUUID(),
    ana: randomUUID(),
    anaAtHome: randomUUID(),
    pedro: randomUUID(),
    personalCategory: randomUUID(),
    householdCategory: randomUUID(),
    bank: randomUUID(),
    expense: randomUUID(),
    settlement: randomUUID(),
    audit: randomUUID(),
    plan: randomUUID(),
    otherPlan: randomUUID(),
    line: randomUUID(),
    allocation: randomUUID(),
    claim: randomUUID(),
  };
  const user = randomUUID();
  const run = (text: string, values: unknown[]) => client.query(text, values);
  await run(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Ana', $2)`, [user, `${user}@example.com`]);
  await run(
    `INSERT INTO spaces (id, name, kind, currency, period_policy, personal_owner_user_id, created_at)
     VALUES ($1, 'Ana', 'PERSONAL', 'COP', '{}', $3, now()), ($2, 'Household', 'SHARED', 'COP', '{}', NULL, now())`,
    [ids.personal, ids.household, user],
  );
  await run(
    `INSERT INTO space_members (id, space_id, kind, user_id, display_name, role, joined_at)
     VALUES ($1, $4, 'USER', $6, 'Ana', 'OWNER', now()), ($2, $5, 'USER', $6, 'Ana', 'OWNER', now()),
            ($3, $5, 'GUEST', NULL, 'Pedro', NULL, now())`,
    [ids.ana, ids.anaAtHome, ids.pedro, ids.personal, ids.household, user],
  );
  const personalGroup = randomUUID();
  const householdGroup = randomUUID();
  await run(
    `INSERT INTO category_groups (id, space_id, name, created_at) VALUES ($1, $3, 'Home', now()), ($2, $4, 'Home', now())`,
    [personalGroup, householdGroup, ids.personal, ids.household],
  );
  await run(
    `INSERT INTO categories (id, space_id, group_id, name, icon_kind, icon_value, color, created_at)
     VALUES ($1, $3, $5, 'Groceries', 'SYMBOL', 'tag', 'GRAPHITE', now()),
            ($2, $4, $6, 'Groceries', 'SYMBOL', 'tag', 'GRAPHITE', now())`,
    [ids.personalCategory, ids.householdCategory, ids.personal, ids.household, personalGroup, householdGroup],
  );
  await run(
    `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, created_at)
     VALUES ($1, $2, 'Bancolombia', 'BANK', $3, 0, now())`,
    [ids.bank, ids.personal, user],
  );
  // D9: a settlement of Household paid from Ana's personal account.
  await run(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency,
       source_account_id, receiving_member_id, payer_member_id, created_by, created_at, updated_at)
     VALUES ($1, $3, 'EXPENSE', '', '2026-10-05', $4, 100, 'COP', NULL, NULL, NULL, $8, now(), now()),
            ($2, $3, 'SETTLEMENT', '', '2026-10-06', NULL, 50, 'COP', $5, $6, $7, $8, now(), now())`,
    [
      ids.expense,
      ids.settlement,
      ids.household,
      ids.householdCategory,
      ids.bank,
      ids.pedro,
      ids.anaAtHome,
      user,
    ],
  );
  await run(
    `INSERT INTO shares (transaction_id, position, member_id, amount, split_method)
     VALUES ($1, 0, $2, 50, 'EQUAL'), ($1, 1, $3, 50, 'EQUAL')`,
    [ids.expense, ids.anaAtHome, ids.pedro],
  );
  await run(
    `INSERT INTO transaction_audit (id, transaction_id, action, actor_user_id, at, changes)
     VALUES ($1, $2, 'UPDATED', $3, now(), '{}')`,
    [ids.audit, ids.expense, user],
  );
  await run(
    `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_by, created_at, updated_at)
     VALUES ($1, $3, '2026-10', '2026-10-01', '2026-10-31', 'ACTIVE', $4, now(), now()),
            ($2, $3, '2026-11', '2026-11-01', '2026-11-30', 'DRAFT', $4, now(), now())`,
    [ids.plan, ids.otherPlan, ids.household, user],
  );
  await run(
    `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
       is_catch_all, allocation_rule, created_at, updated_at)
     VALUES ($1, $2, 'Home', 1000, 'DIRECT', '{}', 'RESET', false, 'PERCENT', now(), now())`,
    [ids.line, ids.plan],
  );
  await run(
    `INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at) VALUES ($1, $2, $3, now())`,
    [ids.plan, ids.line, ids.householdCategory],
  );
  await run(
    `INSERT INTO budget_allocations (id, line_id, member_id, rule, value, set_at)
     VALUES ($1, $2, $3, 'PERCENT', 10000, now())`,
    [ids.allocation, ids.line, ids.anaAtHome],
  );
  await run(
    `INSERT INTO space_invitations (id, space_id, kind, role, token_hash, status, created_by, created_at, expires_at,
       guest_member_id)
     VALUES ($1, $2, 'CLAIM', 'MEMBER', $3, 'PENDING', $4, now(), now() + interval '7 days', $5)`,
    [ids.claim, ids.household, randomUUID(), user, ids.pedro],
  );
  return { user, ...ids };
};

interface Guard {
  /** The rule the case breaks, as the test name. */
  readonly name: string;
  /** Puts one row that breaks the new constraint in place, as a writer outside the app could have. */
  readonly breakIt: (w: World) => Statement;
  /** What the migration answers. */
  readonly refusal: RegExp;
  /** Reads back the row the case broke, to prove the refused migration left it as it was. */
  readonly readBack: (w: World) => Statement;
  /** The correction an operator would make by hand. */
  readonly fixIt: (w: World) => Statement;
}

/** #249: each migration reads the existing rows first; one row that breaks it stops it, and nothing is changed. */
const guarded: Record<string, readonly Guard[]> = {
  "0021_ledger_vocabulary": [
    {
      name: "an account type outside ACCOUNT_TYPES",
      breakIt: (w) => ["UPDATE accounts SET type = 'PIGGY_BANK' WHERE id = $1", [w.bank]],
      refusal: /0021_ledger_vocabulary: accounts with a type outside ACCOUNT_TYPES: .*\(PIGGY_BANK\)/,
      readBack: (w) => ["SELECT type AS v FROM accounts WHERE id = $1", [w.bank]],
      fixIt: (w) => ["UPDATE accounts SET type = 'BANK' WHERE id = $1", [w.bank]],
    },
    {
      name: "an unknown split method",
      breakIt: (w) => ["UPDATE shares SET split_method = 'HALVES' WHERE transaction_id = $1", [w.expense]],
      refusal: /0021_ledger_vocabulary: shares with an unknown split_method: .*\(HALVES\)/,
      readBack: (w) => ["SELECT min(split_method) AS v FROM shares WHERE transaction_id = $1", [w.expense]],
      fixIt: (w) => ["UPDATE shares SET split_method = 'EQUAL' WHERE transaction_id = $1", [w.expense]],
    },
    {
      name: "two shares for one member",
      breakIt: (w) => [
        "UPDATE shares SET member_id = $2 WHERE transaction_id = $1 AND position = 1",
        [w.expense, w.anaAtHome],
      ],
      refusal: /0021_ledger_vocabulary: transactions with two shares for one member/,
      readBack: (w) => [
        "SELECT count(DISTINCT member_id)::int AS v FROM shares WHERE transaction_id = $1",
        [w.expense],
      ],
      fixIt: (w) => [
        "UPDATE shares SET member_id = $2 WHERE transaction_id = $1 AND position = 1",
        [w.expense, w.pedro],
      ],
    },
    {
      name: "an unknown audit action",
      breakIt: (w) => ["UPDATE transaction_audit SET action = 'EDITED' WHERE id = $1", [w.audit]],
      refusal: /0021_ledger_vocabulary: transaction_audit entries with an unknown action: .*\(EDITED\)/,
      readBack: (w) => ["SELECT action AS v FROM transaction_audit WHERE id = $1", [w.audit]],
      fixIt: (w) => ["UPDATE transaction_audit SET action = 'UPDATED' WHERE id = $1", [w.audit]],
    },
  ],
  "0022_budgeting_vocabulary": [
    {
      name: "an unknown plan status",
      breakIt: (w) => ["UPDATE budget_plans SET status = 'OPEN' WHERE id = $1", [w.plan]],
      refusal: /0022_budgeting_vocabulary: budget_plans with an unknown status: .*\(OPEN\)/,
      readBack: (w) => ["SELECT status AS v FROM budget_plans WHERE id = $1", [w.plan]],
      fixIt: (w) => ["UPDATE budget_plans SET status = 'ACTIVE' WHERE id = $1", [w.plan]],
    },
    {
      name: "an unknown funding",
      breakIt: (w) => ["UPDATE budget_lines SET funding = 'CASH' WHERE id = $1", [w.line]],
      refusal: /0022_budgeting_vocabulary: budget_lines with an unknown funding: .*\(CASH\)/,
      readBack: (w) => ["SELECT funding AS v FROM budget_lines WHERE id = $1", [w.line]],
      fixIt: (w) => ["UPDATE budget_lines SET funding = 'DIRECT' WHERE id = $1", [w.line]],
    },
    {
      name: "an unknown rollover mode",
      breakIt: (w) => ["UPDATE budget_lines SET rollover_mode = 'CARRY' WHERE id = $1", [w.line]],
      refusal: /0022_budgeting_vocabulary: budget_lines with an unknown rollover_mode: .*\(CARRY\)/,
      readBack: (w) => ["SELECT rollover_mode AS v FROM budget_lines WHERE id = $1", [w.line]],
      fixIt: (w) => ["UPDATE budget_lines SET rollover_mode = 'RESET' WHERE id = $1", [w.line]],
    },
    {
      name: "an unknown allocation rule",
      breakIt: (w) => ["UPDATE budget_lines SET allocation_rule = 'EVEN' WHERE id = $1", [w.line]],
      refusal: /0022_budgeting_vocabulary: budget_lines with an unknown allocation_rule: .*\(EVEN\)/,
      readBack: (w) => ["SELECT allocation_rule AS v FROM budget_lines WHERE id = $1", [w.line]],
      fixIt: (w) => ["UPDATE budget_lines SET allocation_rule = 'PERCENT' WHERE id = $1", [w.line]],
    },
    {
      name: "a member value under a rule that has none",
      breakIt: (w) => ["UPDATE budget_allocations SET rule = 'PROPORTIONAL' WHERE id = $1", [w.allocation]],
      refusal:
        /0022_budgeting_vocabulary: budget_allocations with a rule other than PERCENT or FIXED: .*\(PROPORTIONAL\)/,
      readBack: (w) => ["SELECT rule AS v FROM budget_allocations WHERE id = $1", [w.allocation]],
      fixIt: (w) => ["UPDATE budget_allocations SET rule = 'PERCENT' WHERE id = $1", [w.allocation]],
    },
  ],
  "0023_line_category_plan": [
    {
      name: "a mapping that names another plan than its line's",
      breakIt: (w) => [
        "UPDATE budget_line_categories SET plan_id = $2 WHERE line_id = $1",
        [w.line, w.otherPlan],
      ],
      refusal:
        /0023_line_category_plan: budget_line_categories whose plan_id is not their line's plan: [0-9a-f-]{36}/,
      readBack: (w) => ["SELECT plan_id AS v FROM budget_line_categories WHERE line_id = $1", [w.line]],
      fixIt: (w) => ["UPDATE budget_line_categories SET plan_id = $2 WHERE line_id = $1", [w.line, w.plan]],
    },
  ],
  "0024_claim_guest_space": [
    {
      name: "a claim link whose guest belongs to another space",
      breakIt: (w) => ["UPDATE space_invitations SET space_id = $2 WHERE id = $1", [w.claim, w.personal]],
      refusal: /0024_claim_guest_space: claim links whose guest belongs to another space: [0-9a-f-]{36}/,
      readBack: (w) => ["SELECT space_id AS v FROM space_invitations WHERE id = $1", [w.claim]],
      fixIt: (w) => ["UPDATE space_invitations SET space_id = $2 WHERE id = $1", [w.claim, w.household]],
    },
  ],
};

describe.each(Object.entries(guarded))("migration %s on existing rows (#249)", (tag, guards) => {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  const previous = journal.entries[index - 1]!.tag;

  it.each(guards)("stops on $name, changes nothing, and applies once the row is corrected", async (guard) => {
    const url = await emptyDatabase();
    await runMigrations(url, migrationsThrough(previous));
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const w = await seed(client);
      await exec(client, guard.breakIt(w));
      const broken = (await exec(client, guard.readBack(w))).rows[0].v;

      expect(await refusalOf(runMigrations(url, migrationsThrough(tag)))).toMatch(guard.refusal);
      expect(await appliedCount(client)).toBe(index);
      expect((await exec(client, guard.readBack(w))).rows[0].v).toEqual(broken);

      await exec(client, guard.fixIt(w));
      await runMigrations(url, migrationsThrough(tag));
      expect(await appliedCount(client)).toBe(index + 1);
    } finally {
      await client.end();
    }
  });

  it("applies over a world whose rows already keep it", async () => {
    const url = await emptyDatabase();
    await runMigrations(url, migrationsThrough(previous));
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await seed(client);
      await runMigrations(url, migrationsThrough(tag));
      expect(await appliedCount(client)).toBe(index + 1);
    } finally {
      await client.end();
    }
  });
});
