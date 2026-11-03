import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_TYPES } from "@/modules/accounts/domain/account-type";
import { ALLOCATION_RULES, FUNDINGS, ROLLOVER_MODES } from "@/modules/budgeting/domain/budget-line";
import { PLAN_STATUSES } from "@/modules/budgeting/domain/plan";
import { AuditEntrySchema, ShareSchema } from "@/modules/ledger/contracts/ledger.contract";
import { testDatabase } from "../../tests/support/database";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../tests/support/fixtures";

// #249: the invariants the database keeps on its own, so a writer that skips the app still cannot break them. Each
// constraint refuses a bad row here; every value the domain and the contract know is accepted, and the integration and
// acceptance suites prove the app's own writes still pass.
const { db, pool } = testDatabase();
let w: SharedLedgerFixture;

beforeAll(async () => {
  w = await sharedLedgerFixture(db, pool);
});
afterAll(() => pool.end());

/** An EXPENSE of Household in `groceries`, with no parts; returns its id. */
const expense = async (): Promise<string> => {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by,
       created_at, updated_at)
     VALUES ($1, $2, 'EXPENSE', '', '2026-10-05', $3, 100, 'COP', $4, now(), now())`,
    [id, w.household.spaceId, w.groceries, w.household.userId],
  );
  return id;
};

const share = (transactionId: string, position: number, memberId: string, splitMethod = "EQUAL") =>
  pool.query(
    "INSERT INTO shares (transaction_id, position, member_id, amount, split_method) VALUES ($1, $2, $3, 50, $4)",
    [transactionId, position, memberId, splitMethod],
  );

const audit = (transactionId: string, action: string) =>
  pool.query(
    `INSERT INTO transaction_audit (id, transaction_id, action, actor_user_id, at, changes)
     VALUES ($1, $2, $3, $4, now(), '{}')`,
    [randomUUID(), transactionId, action, w.household.userId],
  );

/** An account of Ana's personal space; SHARED_FUND, the only type without an owner, goes to Household. */
const account = (type: string) =>
  pool.query(
    `INSERT INTO accounts (id, space_id, name, type, owner_user_id, opening_balance, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, now())`,
    type === "SHARED_FUND"
      ? [randomUUID(), w.household.spaceId, `Fund ${randomUUID()}`, type, null]
      : [randomUUID(), w.personal.spaceId, `Account ${randomUUID()}`, type, w.personal.userId],
  );

describe("closed vocabularies of the ledger and the accounts (#249, M1-9)", () => {
  it("accepts every account type of the domain and refuses any other", async () => {
    for (const type of ACCOUNT_TYPES) await expect(account(type)).resolves.toBeDefined();
    await expect(account("PIGGY_BANK")).rejects.toThrow(/accounts_type/);
  });

  it("accepts every split method of the contract and refuses any other", async () => {
    for (const method of ShareSchema.shape.splitMethod.options) {
      await expect(share(await expense(), 0, w.pedro, method)).resolves.toBeDefined();
    }
    await expect(share(await expense(), 0, w.pedro, "HALVES")).rejects.toThrow(/shares_split_method/);
  });

  it("keeps one share per member of a transaction", async () => {
    const id = await expense();
    await share(id, 0, w.pedro);
    await expect(share(id, 1, w.household.memberId)).resolves.toBeDefined();
    await expect(share(id, 2, w.pedro)).rejects.toThrow(/shares_transaction_member_uq/);
    // The same member still takes a share of every other transaction.
    await expect(share(await expense(), 0, w.pedro)).resolves.toBeDefined();
  });

  it("accepts every audit action of the contract and refuses any other", async () => {
    const id = await expense();
    for (const action of AuditEntrySchema.shape.action.options) {
      await expect(audit(id, action)).resolves.toBeDefined();
    }
    await expect(audit(id, "EDITED")).rejects.toThrow(/transaction_audit_action/);
  });
});

let periods = 0;

/** A plan of Household in a period of its own (one plan per space and start date). */
const plan = async (status = "DRAFT"): Promise<string> => {
  const id = randomUUID();
  const year = 2100 + periods++;
  await pool.query(
    `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
    [id, w.household.spaceId, String(year), `${year}-01-01`, `${year}-01-31`, status, w.household.userId],
  );
  return id;
};

interface LineColumns {
  readonly funding?: string;
  readonly rolloverMode?: string;
  readonly allocationRule?: string;
}

/** A line of `planId`; a SAVINGS line names one savings account, as budget_lines_savings_accounts asks. */
const line = async (planId: string, columns: LineColumns = {}): Promise<string> => {
  const id = randomUUID();
  const funding = columns.funding ?? "DIRECT";
  await pool.query(
    `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
       is_catch_all, allocation_rule, created_at, updated_at)
     VALUES ($1, $2, $3, 1000, $4, $5, $6, false, $7, now(), now())`,
    [
      id,
      planId,
      `Line ${id}`,
      funding,
      funding === "SAVINGS" ? [randomUUID()] : [],
      columns.rolloverMode ?? "RESET",
      columns.allocationRule ?? "PROPORTIONAL",
    ],
  );
  return id;
};

const allocation = async (rule: string) =>
  pool.query(
    "INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at) VALUES ($1, $2, $3, 100, now())",
    [await line(await plan()), w.pedro, rule],
  );

describe("closed vocabularies of budgeting (#249, M3A-2)", () => {
  it("accepts every plan status of the domain and refuses any other", async () => {
    for (const status of PLAN_STATUSES) await expect(plan(status)).resolves.toBeDefined();
    await expect(plan("OPEN")).rejects.toThrow(/budget_plans_status/);
  });

  it("accepts every funding, rollover mode and allocation rule of the domain and refuses any other", async () => {
    const planId = await plan();
    for (const funding of FUNDINGS) await expect(line(planId, { funding })).resolves.toBeDefined();
    for (const rolloverMode of ROLLOVER_MODES)
      await expect(line(planId, { rolloverMode })).resolves.toBeDefined();
    for (const allocationRule of ALLOCATION_RULES) {
      await expect(line(planId, { allocationRule })).resolves.toBeDefined();
    }
    await expect(line(planId, { funding: "CASH" })).rejects.toThrow(/budget_lines_funding/);
    await expect(line(planId, { rolloverMode: "CARRY" })).rejects.toThrow(/budget_lines_rollover_mode/);
    await expect(line(planId, { allocationRule: "EVEN" })).rejects.toThrow(/budget_lines_allocation_rule/);
  });

  it("keeps member values to the two rules that have them, PERCENT and FIXED", async () => {
    const valued = ALLOCATION_RULES.filter((rule) => rule === "PERCENT" || rule === "FIXED");
    for (const rule of valued) await expect(allocation(rule)).resolves.toBeDefined();
    for (const rule of ["PROPORTIONAL", "NONE", "SHARE"]) {
      await expect(allocation(rule)).rejects.toThrow(/budget_allocations_rule/);
    }
  });
});
