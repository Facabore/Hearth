import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  sharedLedgerFixture,
} from "../../../../tests/support/fixtures";
import { InMemoryRecurrences } from "../../../../tests/support/in-memory-recurrences";
import { unwrap } from "../../../../tests/support/fakes";
import type { OccurrenceRepository, RecurrenceRepository } from "../application";
import {
  confirmedOccurrence,
  pendingOccurrence,
  recordedOccurrence,
  skippedByMember,
  skippedOccurrence,
  type OccurrenceId,
} from "../domain/occurrence";
import { statusOf, type Recurrence, type RecurrenceId, type RecurrenceTemplate } from "../domain/recurrence";
import { recordExpense, type TransactionId } from "../domain/transaction";
import { DrizzleRecurrenceRepository } from "./drizzle-recurrence-repository";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleRecurrenceRepository(tm);

afterAll(() => pool.end());

/** A fresh Ana with her bank, savings account and salary category, and Household with its fund, Pedro and groceries. */
const fixture = async () => {
  const w = await sharedLedgerFixture(db, pool);
  return {
    ...w,
    savings: await accountFixture(db, w.personal, "Ahorros"),
    salary: await categoryFixture(db, w.personal, "Salary"),
  };
};

type World = Awaited<ReturnType<typeof fixture>>;

interface Template {
  readonly categoryId?: string;
  readonly payerMemberId?: string;
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
  readonly split?: object;
  readonly amount?: string;
}

// Every row is inserted already ended, so no scheduler test ever sees it.
const insertRecurrence = (
  f: World,
  type: string,
  template: Template,
  endDate: string | null = null,
): Promise<string> => {
  const id = randomUUID();
  return pool
    .query(
      `INSERT INTO recurrences (id, space_id, type, description, amount, currency, category_id, payer_member_id,
         source_account_id, destination_account_id, split, schedule, mode, start_date, end_date, due_from, ended_at,
         created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'Rent', $4, 'COP', $5, $6, $7, $8, $9::jsonb, '{"kind":"MONTHLY","day":1}', 'AUTO',
         '2026-12-01', $10, '2026-12-01', now(), $11, now(), now())`,
      [
        id,
        f.household.spaceId,
        type,
        template.amount ?? "100",
        template.categoryId ?? null,
        template.payerMemberId ?? null,
        template.sourceAccountId ?? null,
        template.destinationAccountId ?? null,
        template.split === undefined ? null : JSON.stringify(template.split),
        endDate,
        f.household.userId,
      ],
    )
    .then(() => id);
};

/** A valid expense paid by the fund, the cheapest recurrence to hang occurrences from. */
const expenseRecurrence = (f: World) =>
  insertRecurrence(f, "EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund });

const insertOccurrence = (
  f: World,
  recurrenceId: string,
  date: string,
  status: string,
  transactionId: string | null = null,
  amount = "100",
) =>
  pool.query(
    `INSERT INTO recurrence_occurrences (id, recurrence_id, space_id, occurrence_date, status, amount, transaction_id,
       created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [randomUUID(), recurrenceId, f.household.spaceId, date, status, amount, transactionId],
  );

/** An expense transaction for an occurrence to record; only what the occurrence points to references it. */
const insertTransaction = async (f: World): Promise<string> => {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by,
       created_at, updated_at)
     VALUES ($1, $2, 'EXPENSE', 'Rent', '2026-12-01', $3, 100, 'COP', $4, now(), now())`,
    [id, f.household.spaceId, f.groceries, f.household.userId],
  );
  return id;
};

const count = async (table: string, id: string): Promise<number> =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id])).rows[0].n;

const day = (iso: string) => iso as LocalDate;

let created = 0;
/** A recurrence with `template`, MONTHLY(1), AUTO, due from 2026-12-01; each created one millisecond after the last. */
const recurrence = (
  f: World,
  spaceId: string,
  template: RecurrenceTemplate,
  overrides: Partial<Recurrence> = {},
): Recurrence => {
  const at = new Date(Date.UTC(2026, 9, 28, 17, 0, 0, ++created));
  return {
    id: randomUUID() as RecurrenceId,
    spaceId,
    description: "Rent",
    amount: 120_000_000n,
    currency: "COP",
    template,
    schedule: { kind: "MONTHLY", day: 1 },
    mode: "AUTO",
    startDate: day("2026-12-01"),
    endDate: null,
    dueFrom: day("2026-12-01"),
    pausedAt: null,
    pauseReason: null,
    endedAt: null,
    createdBy: f.household.userId,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

/** One recurrence of every template shape: the fund pays 40 / 60 %, Pedro pays alone, Ana's salary, saving, contribution. */
const everyShape = (f: World): Recurrence[] => [
  recurrence(f, f.household.spaceId, {
    type: "EXPENSE",
    categoryId: f.groceries,
    payer: { memberId: null, accountId: f.fund },
    split: {
      method: "PERCENT",
      participants: [
        { memberId: f.household.memberId, basisPoints: 4000 },
        { memberId: f.pedro, basisPoints: 6000 },
      ],
    },
  }),
  recurrence(
    f,
    f.household.spaceId,
    { type: "EXPENSE", categoryId: f.groceries, payer: { memberId: f.pedro, accountId: null }, split: null },
    { mode: "CONFIRM", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, endDate: day("2027-06-30") },
  ),
  recurrence(f, f.personal.spaceId, { type: "INCOME", categoryId: f.salary, accountId: f.bank }),
  recurrence(f, f.personal.spaceId, {
    type: "TRANSFER",
    sourceAccountId: f.bank,
    destinationAccountId: f.savings,
  }),
  recurrence(f, f.household.spaceId, {
    type: "FUND_CONTRIBUTION",
    fundAccountId: f.fund,
    memberId: f.household.memberId,
    sourceAccountId: f.bank,
  }),
];

/** An expense the fund pays and the default split divides: the cheapest template. */
const paidByFund = (f: World): RecurrenceTemplate => ({
  type: "EXPENSE",
  categoryId: f.groceries,
  payer: { memberId: null, accountId: f.fund },
  split: null,
});

/** Stores the same recurrences in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryRecurrences, rows: readonly Recurrence[]) => {
  for (const row of rows) {
    await repo.add(row);
    await memory.add(row);
  }
};

describe("the recurrence tables (HU-E4-11, HU-E4-12)", () => {
  it("refuses templates of the wrong shape (recurrences_shape) and an end before the start (recurrences_dates)", async () => {
    const f = await fixture();
    const insert = (
      type: string,
      columns: {
        categoryId?: string;
        payerMemberId?: string;
        sourceAccountId?: string;
        destinationAccountId?: string;
      },
      endDate: string | null = null,
    ) => insertRecurrence(f, type, columns, endDate);
    await expect(insert("EXPENSE", { categoryId: f.groceries })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("INCOME", { categoryId: f.salary })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("TRANSFER", { sourceAccountId: f.bank })).rejects.toThrow(/recurrences_shape/);
    await expect(insert("FUND_CONTRIBUTION", { destinationAccountId: f.fund })).rejects.toThrow(
      /recurrences_shape/,
    );
    await expect(
      insert("EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund }, "2026-11-30"),
    ).rejects.toThrow(/recurrences_dates/);
    await expect(
      insert("EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund }),
    ).resolves.toBeDefined();
    await expect(
      insert("TRANSFER", { sourceAccountId: f.bank, destinationAccountId: f.savings }),
    ).resolves.toBeDefined();
  });

  it("accepts an end on the start date, which makes the end date inclusive", async () => {
    const f = await fixture();
    await expect(
      insertRecurrence(f, "EXPENSE", { categoryId: f.groceries, sourceAccountId: f.fund }, "2026-12-01"),
    ).resolves.toBeDefined();
  });

  const halves = (f: World) => ({
    method: "PERCENT",
    participants: [
      { memberId: f.household.memberId, basisPoints: 5000 },
      { memberId: f.pedro, basisPoints: 5000 },
    ],
  });

  interface ShapeCase {
    readonly name: string;
    readonly type: string;
    readonly columns: (f: World) => Template;
  }

  // Each required reference omitted in turn, every other term of the branch satisfied, so that only that term refuses.
  const missing: ShapeCase[] = [
    { name: "an expense without a category", type: "EXPENSE", columns: (f) => ({ sourceAccountId: f.fund }) },
    { name: "an expense paid by nobody", type: "EXPENSE", columns: (f) => ({ categoryId: f.groceries }) },
    {
      name: "an income without a category",
      type: "INCOME",
      columns: (f) => ({ destinationAccountId: f.bank }),
    },
    {
      name: "an income into no account",
      type: "INCOME",
      columns: (f) => ({ categoryId: f.salary }),
    },
    {
      name: "a transfer without a source account",
      type: "TRANSFER",
      columns: (f) => ({ destinationAccountId: f.savings }),
    },
    {
      name: "a transfer without a destination account",
      type: "TRANSFER",
      columns: (f) => ({ sourceAccountId: f.bank }),
    },
    {
      name: "a contribution without a destination account",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({ payerMemberId: f.household.memberId, sourceAccountId: f.bank }),
    },
    {
      name: "a contribution without a member",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({ destinationAccountId: f.fund }),
    },
  ];

  // What a type may not carry, and the types that are none.
  const excess: ShapeCase[] = [
    {
      name: "an expense with a destination account",
      type: "EXPENSE",
      columns: (f) => ({ categoryId: f.groceries, sourceAccountId: f.fund, destinationAccountId: f.savings }),
    },
    {
      name: "an income with a source account",
      type: "INCOME",
      columns: (f) => ({ categoryId: f.salary, destinationAccountId: f.bank, sourceAccountId: f.savings }),
    },
    {
      name: "an income with a payer",
      type: "INCOME",
      columns: (f) => ({
        categoryId: f.salary,
        destinationAccountId: f.bank,
        payerMemberId: f.household.memberId,
      }),
    },
    {
      name: "a transfer with a category",
      type: "TRANSFER",
      columns: (f) => ({ sourceAccountId: f.bank, destinationAccountId: f.savings, categoryId: f.salary }),
    },
    {
      name: "a transfer with a payer",
      type: "TRANSFER",
      columns: (f) => ({
        sourceAccountId: f.bank,
        destinationAccountId: f.savings,
        payerMemberId: f.household.memberId,
      }),
    },
    {
      name: "a contribution with a category",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({
        payerMemberId: f.household.memberId,
        destinationAccountId: f.fund,
        categoryId: f.groceries,
      }),
    },
    // Only an expense shares: the other types never carry a split.
    {
      name: "an income with a split",
      type: "INCOME",
      columns: (f) => ({ categoryId: f.salary, destinationAccountId: f.bank, split: halves(f) }),
    },
    {
      name: "a transfer with a split",
      type: "TRANSFER",
      columns: (f) => ({ sourceAccountId: f.bank, destinationAccountId: f.savings, split: halves(f) }),
    },
    {
      name: "a contribution with a split",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({
        payerMemberId: f.household.memberId,
        destinationAccountId: f.fund,
        split: halves(f),
      }),
    },
    {
      name: "a settlement, which no recurrence repeats",
      type: "SETTLEMENT",
      columns: (f) => ({ categoryId: f.groceries, sourceAccountId: f.fund }),
    },
    {
      name: "a type in lower case",
      type: "expense",
      columns: (f) => ({ categoryId: f.groceries, sourceAccountId: f.fund }),
    },
  ];

  it.each([...missing, ...excess])("refuses $name (recurrences_shape)", async ({ type, columns }) => {
    const f = await fixture();
    await expect(insertRecurrence(f, type, columns(f))).rejects.toThrow(/recurrences_shape/);
  });

  // An expense is paid by the fund, by a member with an account, or by a guest, who has none; an income lands in an
  // account; a transfer moves between two; a contribution goes from a member into the fund, from outside the app if
  // the member is a guest.
  const accepted: ShapeCase[] = [
    {
      name: "an expense paid by the fund",
      type: "EXPENSE",
      columns: (f) => ({ categoryId: f.groceries, sourceAccountId: f.fund }),
    },
    {
      name: "an expense paid by a guest with no account",
      type: "EXPENSE",
      columns: (f) => ({ categoryId: f.groceries, payerMemberId: f.pedro }),
    },
    {
      name: "an expense paid by a member from an account",
      type: "EXPENSE",
      columns: (f) => ({
        categoryId: f.groceries,
        payerMemberId: f.household.memberId,
        sourceAccountId: f.bank,
      }),
    },
    {
      name: "an income into an account",
      type: "INCOME",
      columns: (f) => ({ categoryId: f.salary, destinationAccountId: f.bank }),
    },
    {
      name: "a transfer between two accounts",
      type: "TRANSFER",
      columns: (f) => ({ sourceAccountId: f.bank, destinationAccountId: f.savings }),
    },
    {
      name: "a contribution from a guest, outside the app",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({ payerMemberId: f.pedro, destinationAccountId: f.fund }),
    },
    {
      name: "a contribution from a member's account",
      type: "FUND_CONTRIBUTION",
      columns: (f) => ({
        payerMemberId: f.household.memberId,
        sourceAccountId: f.bank,
        destinationAccountId: f.fund,
      }),
    },
  ];

  it.each(accepted)("accepts $name (recurrences_shape)", async ({ type, columns }) => {
    const f = await fixture();
    await expect(insertRecurrence(f, type, columns(f))).resolves.toBeDefined();
  });

  it("stores an expense's split as the ratios it was given", async () => {
    const f = await fixture();
    const id = await insertRecurrence(f, "EXPENSE", {
      categoryId: f.groceries,
      sourceAccountId: f.fund,
      split: halves(f),
    });
    const stored = await pool.query("SELECT split FROM recurrences WHERE id = $1", [id]);
    expect(stored.rows[0].split).toEqual(halves(f));
  });

  it("plans positive amounts as bigint minor units no number could hold, and keeps schedule and split as jsonb (recurrences_amount_positive)", async () => {
    const f = await fixture();
    const template = { categoryId: f.groceries, sourceAccountId: f.fund };
    await expect(insertRecurrence(f, "EXPENSE", { ...template, amount: "0" })).rejects.toThrow(
      /recurrences_amount_positive/,
    );
    await expect(insertRecurrence(f, "EXPENSE", { ...template, amount: "-1" })).rejects.toThrow(
      /recurrences_amount_positive/,
    );
    const id = await insertRecurrence(f, "EXPENSE", { ...template, amount: "9007199254740993" });
    const { rows } = await pool.query("SELECT amount::text AS amount FROM recurrences WHERE id = $1", [id]);
    expect(rows[0].amount).toBe("9007199254740993");

    const { rows: types } = await pool.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_name IN ('recurrences', 'recurrence_occurrences')
          AND column_name IN ('amount', 'split', 'schedule')
        ORDER BY table_name, column_name`,
    );
    expect(types).toEqual([
      { table_name: "recurrence_occurrences", column_name: "amount", data_type: "bigint" },
      { table_name: "recurrences", column_name: "amount", data_type: "bigint" },
      { table_name: "recurrences", column_name: "schedule", data_type: "jsonb" },
      { table_name: "recurrences", column_name: "split", data_type: "jsonb" },
    ]);
  });

  it("indexes the active recurrences by the date they are due and the pending occurrences by space and date", async () => {
    const { rows } = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('recurrences_active_idx', 'recurrence_occurrences_pending_idx')
        ORDER BY indexname`,
    );
    expect(rows).toHaveLength(2);
    const [pending, active] = rows.map((r) => r.indexdef as string);
    expect(active).toMatch(/\(due_from\) WHERE \(\(paused_at IS NULL\) AND \(ended_at IS NULL\)\)/);
    expect(pending).toMatch(/\(space_id, occurrence_date\) WHERE \(status = 'PENDING'::text\)/);
  });
});

describe("the occurrence table (HU-E4-12, HU-E4-13)", () => {
  it("holds one occurrence per recurrence and date, whatever races (recurrence_occurrences_date_uq)", async () => {
    const f = await fixture();
    const rent = await expenseRecurrence(f);
    const other = await expenseRecurrence(f);
    await insertOccurrence(f, rent, "2026-12-01", "PENDING");
    await expect(insertOccurrence(f, rent, "2026-12-01", "PENDING")).rejects.toThrow(
      /recurrence_occurrences_date_uq/,
    );
    // Whatever the status of the first: a skipped date is not recorded again either.
    await expect(insertOccurrence(f, rent, "2026-12-01", "SKIPPED")).rejects.toThrow(
      /recurrence_occurrences_date_uq/,
    );
    await expect(insertOccurrence(f, rent, "2027-01-01", "PENDING")).resolves.toBeDefined();
    await expect(insertOccurrence(f, other, "2026-12-01", "PENDING")).resolves.toBeDefined();
  });

  it("ties RECORDED to a transaction and gives no other status one (recurrence_occurrences_recorded)", async () => {
    const f = await fixture();
    const rent = await expenseRecurrence(f);
    const recorded = await insertTransaction(f);
    await expect(insertOccurrence(f, rent, "2026-12-01", "RECORDED")).rejects.toThrow(
      /recurrence_occurrences_recorded/,
    );
    await expect(insertOccurrence(f, rent, "2026-12-01", "PENDING", recorded)).rejects.toThrow(
      /recurrence_occurrences_recorded/,
    );
    await expect(insertOccurrence(f, rent, "2026-12-01", "SKIPPED", recorded)).rejects.toThrow(
      /recurrence_occurrences_recorded/,
    );
    await expect(insertOccurrence(f, rent, "2026-12-01", "RECORDED", recorded)).resolves.toBeDefined();
    await expect(insertOccurrence(f, rent, "2027-01-01", "PENDING")).resolves.toBeDefined();
    await expect(insertOccurrence(f, rent, "2027-02-01", "SKIPPED")).resolves.toBeDefined();
  });

  it("keeps one occurrence per transaction (recurrence_occurrences_transaction_uq)", async () => {
    const f = await fixture();
    const rent = await expenseRecurrence(f);
    const other = await expenseRecurrence(f);
    const recorded = await insertTransaction(f);
    await insertOccurrence(f, rent, "2026-12-01", "RECORDED", recorded);
    await expect(insertOccurrence(f, rent, "2027-01-01", "RECORDED", recorded)).rejects.toThrow(
      /recurrence_occurrences_transaction_uq/,
    );
    await expect(insertOccurrence(f, other, "2026-12-01", "RECORDED", recorded)).rejects.toThrow(
      /recurrence_occurrences_transaction_uq/,
    );
    // Pending and skipped occurrences have no transaction, and any number of them may share that absence.
    await expect(insertOccurrence(f, rent, "2027-02-01", "PENDING")).resolves.toBeDefined();
    await expect(insertOccurrence(f, rent, "2027-03-01", "SKIPPED")).resolves.toBeDefined();
  });

  it("snapshots a positive amount as bigint minor units (recurrence_occurrences_amount_positive)", async () => {
    const f = await fixture();
    const rent = await expenseRecurrence(f);
    await expect(insertOccurrence(f, rent, "2026-12-01", "PENDING", null, "0")).rejects.toThrow(
      /recurrence_occurrences_amount_positive/,
    );
    await expect(insertOccurrence(f, rent, "2027-01-01", "PENDING", null, "-1")).rejects.toThrow(
      /recurrence_occurrences_amount_positive/,
    );
    await insertOccurrence(f, rent, "2027-02-01", "PENDING", null, "9007199254740993");
    const { rows } = await pool.query(
      "SELECT amount::text AS amount FROM recurrence_occurrences WHERE recurrence_id = $1",
      [rent],
    );
    expect(rows[0].amount).toBe("9007199254740993");
  });
});

describe("foreign keys (D8: only logical deletes)", () => {
  it("declares all eight keys of the recurrence tables NO ACTION, so a migration cannot cascade one unnoticed", async () => {
    const { rows } = await pool.query(
      `SELECT c.conname, c.confdeltype
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'f' AND t.relname IN ('recurrences', 'recurrence_occurrences')
        ORDER BY c.conname`,
    );
    expect(rows).toHaveLength(8);
    // 'a' is NO ACTION; 'c' would be CASCADE, 'n' SET NULL, 'r' RESTRICT, 'd' SET DEFAULT.
    expect(rows.filter((r) => r.confdeltype !== "a").map((r) => r.conname)).toEqual([]);
  });

  it("refuses to delete what a recurrence or an occurrence references, and leaves it in place", async () => {
    const f = await fixture();
    // Each of these is referenced by one row only, so only that row's key stands between it and a cascade.
    const category = await categoryFixture(db, f.household, "Lonely");
    const member = await guestMemberFixture(pool, f.household, "Lonely");
    const sourceAccount = await accountFixture(db, f.personal, "Lonely source");
    const destinationAccount = await accountFixture(db, f.personal, "Lonely destination");
    const expense = await insertRecurrence(f, "EXPENSE", {
      categoryId: category,
      payerMemberId: member,
      sourceAccountId: sourceAccount,
    });
    const transfer = await insertRecurrence(f, "TRANSFER", {
      sourceAccountId: f.bank,
      destinationAccountId: destinationAccount,
    });
    const transaction = await insertTransaction(f);
    await insertOccurrence(f, expense, "2026-12-01", "RECORDED", transaction);

    const refused = (sql: string, id: string, constraint: string) =>
      expect(pool.query(sql, [id])).rejects.toMatchObject({ code: "23503", constraint });
    await refused(
      "DELETE FROM categories WHERE id = $1",
      category,
      "recurrences_category_id_categories_id_fk",
    );
    await refused(
      "DELETE FROM space_members WHERE id = $1",
      member,
      "recurrences_payer_member_id_space_members_id_fk",
    );
    await refused(
      "DELETE FROM accounts WHERE id = $1",
      sourceAccount,
      "recurrences_source_account_id_accounts_id_fk",
    );
    await refused(
      "DELETE FROM accounts WHERE id = $1",
      destinationAccount,
      "recurrences_destination_account_id_accounts_id_fk",
    );
    await refused(
      "DELETE FROM recurrences WHERE id = $1",
      expense,
      "recurrence_occurrences_recurrence_id_recurrences_id_fk",
    );
    await refused(
      "DELETE FROM transactions WHERE id = $1",
      transaction,
      "recurrence_occurrences_transaction_id_transactions_id_fk",
    );

    expect([
      await count("categories", category),
      await count("space_members", member),
      await count("accounts", sourceAccount),
      await count("accounts", destinationAccount),
      await count("recurrences", expense),
      await count("recurrences", transfer),
      await count("transactions", transaction),
    ]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("DrizzleRecurrenceRepository: recurrences (HU-E4-11)", () => {
  it("stores every template shape and reads it back like the in-memory twin", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    await storeInBoth(memory, rows);
    for (const row of rows) expect(await repo.find(row.spaceId, row.id)).toEqual(row);
    for (const spaceId of [f.household.spaceId, f.personal.spaceId]) {
      expect(await repo.list(spaceId)).toEqual(await memory.list(spaceId));
    }
  });

  it("saves what an edit, a pause, a resume and an end change, and deletes nothing (D8)", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    const [rent, pedros, salary, saving, contribution] = rows as [
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
    ];
    await storeInBoth(memory, rows);
    const utilities = await categoryFixture(db, f.household, "Utilities");
    const bonus = await categoryFixture(db, f.personal, "Bonus");
    const later = new Date("2026-12-20T17:00:00Z");
    const changed: [Recurrence, Recurrence, Recurrence, Recurrence] = [
      {
        ...rent,
        description: "Rent 2027",
        amount: 130_000_000n,
        template: {
          type: "EXPENSE",
          categoryId: utilities,
          payer: { memberId: null, accountId: f.fund },
          split: null,
        },
        schedule: { kind: "MONTHLY", day: 5 },
        mode: "CONFIRM",
        endDate: day("2027-12-31"),
        dueFrom: day("2027-01-01"),
        updatedAt: later,
      },
      { ...pedros, pausedAt: later, pauseReason: "PayerLeft", updatedAt: later },
      { ...salary, template: { type: "INCOME", categoryId: bonus, accountId: f.bank }, updatedAt: later },
      { ...saving, endedAt: later, updatedAt: later },
    ];
    const stored = (source: RecurrenceRepository) =>
      Promise.all(rows.map((row) => source.find(row.spaceId, row.id)));
    for (const row of changed) {
      await repo.save(row);
      await memory.save(row);
    }
    for (const source of [repo, memory]) expect(await stored(source)).toEqual([...changed, contribution]);

    // And back: a resume clears the pause and its reason, and an edit may remove the end date.
    const evenLater = new Date("2026-12-21T17:00:00Z");
    const reopened: [Recurrence, Recurrence] = [
      { ...changed[0], endDate: null, updatedAt: evenLater },
      { ...changed[1], pausedAt: null, pauseReason: null, dueFrom: day("2027-01-01"), updatedAt: evenLater },
    ];
    for (const row of reopened) {
      await repo.save(row);
      await memory.save(row);
    }
    for (const source of [repo, memory]) {
      expect(await stored(source)).toEqual([...reopened, changed[2], changed[3], contribution]);
      // The ended recurrence stays listed: nothing is deleted.
      expect(await source.list(f.household.spaceId)).toEqual([...reopened, contribution]);
      expect(await source.list(f.personal.spaceId)).toEqual([changed[2], changed[3]]);
    }
  });

  it("never changes through a save what the recurrence was defined with (ruling P22)", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    const [rent, pedros, salary, saving, contribution] = rows as [
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
    ];
    await storeInBoth(memory, rows);
    const utilities = await categoryFixture(db, f.household, "Utilities");
    const later = new Date("2026-12-20T17:00:00Z");
    const redirect = (row: Recurrence, template: RecurrenceTemplate): Recurrence => ({
      ...row,
      description: "Redirected",
      template,
      updatedAt: later,
    });
    // Each is saved as if someone had pointed it at another payer, account or member, which no edit may do.
    const saved: Recurrence[] = [
      {
        // Another category and no split are edits; the payer, the currency, the start and the creator are not.
        ...redirect(rent, {
          type: "EXPENSE",
          categoryId: utilities,
          payer: { memberId: f.pedro, accountId: null },
          split: null,
        }),
        currency: "USD",
        startDate: day("2026-11-01"),
        createdBy: "someone-else",
        createdAt: new Date(0),
      },
      redirect(pedros, {
        type: "EXPENSE",
        categoryId: f.groceries,
        payer: { memberId: null, accountId: f.fund },
        split: null,
      }),
      redirect(salary, { type: "INCOME", categoryId: f.salary, accountId: f.savings }),
      redirect(saving, { type: "TRANSFER", sourceAccountId: f.savings, destinationAccountId: f.bank }),
      redirect(contribution, {
        type: "FUND_CONTRIBUTION",
        fundAccountId: f.savings,
        memberId: f.pedro,
        sourceAccountId: null,
      }),
    ];
    for (const row of saved) {
      await repo.save(row);
      await memory.save(row);
    }
    const edited = (row: Recurrence): Recurrence => ({ ...row, description: "Redirected", updatedAt: later });
    const expected = [
      {
        ...edited(rent),
        // The category and the split are what an expense's edit changes; its payer and fund stay.
        template: {
          type: "EXPENSE",
          categoryId: utilities,
          payer: { memberId: null, accountId: f.fund },
          split: null,
        },
      },
      edited(pedros),
      edited(salary),
      edited(saving),
      edited(contribution),
    ];
    for (const source of [repo, memory]) {
      expect(await Promise.all(rows.map((row) => source.find(row.spaceId, row.id)))).toEqual(expected);
    }
  });

  it("throws, and writes nothing, for a recurrence no stored one matches by id, space and type (ruling P22)", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const [rent] = everyShape(f) as [Recurrence];
    await storeInBoth(memory, [rent]);
    const edited: Recurrence = {
      ...rent,
      description: "Edited",
      updatedAt: new Date("2026-12-20T17:00:00Z"),
    };
    const misdirected: Recurrence[] = [
      // Another type than the one it was defined with.
      {
        ...edited,
        template: { type: "TRANSFER", sourceAccountId: f.bank, destinationAccountId: f.savings },
      },
      // Another space's.
      { ...edited, spaceId: f.personal.spaceId },
      // One that was never stored.
      { ...edited, id: randomUUID() as RecurrenceId },
    ];
    for (const row of misdirected) {
      const refused = new Error(`recurrence ${row.id} (${row.template.type}) is not stored in its space`);
      await expect(repo.save(row)).rejects.toThrow(refused);
      await expect(memory.save(row)).rejects.toThrow(refused);
    }
    // Inside a transaction the throw rolls back what was saved before it.
    await expect(
      tm.run(async () => {
        await repo.save(edited);
        await repo.save(misdirected[0]!);
        return ok(undefined);
      }),
    ).rejects.toThrow(/is not stored/);
    expect([await repo.find(rent.spaceId, rent.id), await memory.find(rent.spaceId, rent.id)]).toEqual([
      rent,
      rent,
    ]);
  });

  it("lists as active, for a day, every space's recurrences due by then that are neither paused, ended nor past their end (HU-E4-12)", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const household = f.household.spaceId;
    const byFund = paidByFund(f);
    const later = new Date("2026-12-20T17:00:00Z");
    // Created in this order, so that the answer is told apart from the order they were defined in.
    const dueToday = recurrence(f, household, byFund, { dueFrom: day("2026-12-15") });
    const dueTomorrow = recurrence(f, household, byFund, { dueFrom: day("2026-12-16") });
    const paused = recurrence(f, household, byFund, {
      dueFrom: day("2026-12-15"),
      pausedAt: later,
      pauseReason: "PayerLeft",
    });
    const behind = recurrence(f, household, byFund, { dueFrom: day("2026-12-05") });
    const ended = recurrence(f, household, byFund, { dueFrom: day("2026-12-15"), endedAt: later });
    const pastItsEnd = recurrence(f, household, byFund, {
      startDate: day("2026-11-01"),
      endDate: day("2026-12-04"),
      dueFrom: day("2026-12-05"),
    });
    // Its last date is its end date, today.
    const onItsEnd = recurrence(f, household, byFund, {
      schedule: { kind: "MONTHLY", day: 15 },
      endDate: day("2026-12-15"),
      dueFrom: day("2026-12-15"),
    });
    // Its end date is not a schedule date: the next date, 2027-01-01, is past it.
    const noDateLeft = recurrence(f, household, byFund, {
      endDate: day("2026-12-20"),
      dueFrom: day("2026-12-10"),
    });
    const elsewhere = recurrence(
      f,
      f.personal.spaceId,
      { type: "TRANSFER", sourceAccountId: f.bank, destinationAccountId: f.savings },
      { dueFrom: day("2026-12-15") },
    );
    const rows = [dueToday, dueTomorrow, paused, behind, ended, pastItsEnd, onItsEnd, noDateLeft, elsewhere];
    await storeInBoth(memory, rows);

    const ids: string[] = rows.map((r) => r.id);
    // Other files share the database: only this test's recurrences are compared.
    const active = async (source: RecurrenceRepository, today: string) =>
      (await source.listActive(day(today))).filter((a) => ids.includes(a.id));
    const named = (...of: Recurrence[]) => of.map(({ id, spaceId }) => ({ id, spaceId }));
    const answers: [string, ReturnType<typeof named>][] = [
      // Nothing is due yet.
      ["2026-12-04", named()],
      // One due today, one behind that catches up, one whose last date is today, one without a date left, one of
      // another space.
      ["2026-12-15", named(dueToday, behind, onItsEnd, noDateLeft, elsewhere)],
      // The day after, the one due tomorrow is due.
      ["2026-12-16", named(dueToday, dueTomorrow, behind, onItsEnd, noDateLeft, elsewhere)],
    ];
    for (const [today, expected] of answers) {
      expect(await active(repo, today)).toEqual(expected);
      expect(await active(memory, today)).toEqual(expected);
    }
    // Looser than statusOf on purpose: the scheduler's run reads it under the lock and marks it finished.
    expect([statusOf(onItsEnd), statusOf(noDateLeft)]).toEqual(["ACTIVE", "ENDED"]);
  });

  it("answers in the order recurrences were defined, ties broken by id, like the in-memory twin", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const household = f.household.spaceId;
    const [low, high] = [randomUUID(), randomUUID()].sort() as [RecurrenceId, RecurrenceId];
    const sameMoment = new Date("2026-10-28T17:00:00.000Z");
    const laterMoment = new Date("2026-10-28T17:00:01.000Z");
    const definedAt = (id: RecurrenceId, at: Date) =>
      recurrence(f, household, paidByFund(f), { id, createdAt: at, updatedAt: at });
    // Stored out of order: the later one first, then the larger id of the two defined at the same moment.
    const rows = [
      definedAt(randomUUID() as RecurrenceId, laterMoment),
      definedAt(high, sameMoment),
      definedAt(low, sameMoment),
    ];
    await storeInBoth(memory, rows);
    const expected: string[] = [low, high, rows[0]!.id];
    for (const source of [repo, memory]) {
      expect((await source.list(household)).map((r) => r.id)).toEqual(expected);
      const active = await source.listActive(day("2026-12-31"));
      expect(active.map((a) => a.id).filter((id) => expected.includes(id))).toEqual(expected);
    }
  });

  it("reads a recurrence under its row lock, and answers null or [] for malformed and foreign ids (Review Focus 5)", async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const rows = everyShape(f);
    const [rent] = rows as [Recurrence, ...Recurrence[]];
    await storeInBoth(memory, rows);
    expect(await tm.run(async () => ok(await repo.lockForWrite(f.household.spaceId, rent.id)))).toEqual(
      ok(rent),
    );
    expect(await memory.lockForWrite(f.household.spaceId, rent.id)).toEqual(rent);
    expect(memory.locked).toEqual([rent.id]);

    const strangers = async (source: RecurrenceRepository) => [
      await source.find(f.household.spaceId, "not-a-uuid"),
      await source.find("not-a-uuid", rent.id),
      await source.find(f.household.spaceId, randomUUID()),
      // Another space's recurrence never answers.
      await source.find(f.personal.spaceId, rent.id),
      await source.lockForWrite(f.household.spaceId, "not-a-uuid"),
      await source.lockForWrite("not-a-uuid", rent.id),
      await source.lockForWrite(f.personal.spaceId, rent.id),
      await source.list("not-a-uuid"),
      await source.list(randomUUID()),
    ];
    expect(await strangers(repo)).toEqual([null, null, null, null, null, null, null, [], []]);
    expect(await strangers(memory)).toEqual(await strangers(repo));
  });
});

describe("DrizzleRecurrenceRepository: occurrences (HU-E4-12, HU-E4-13)", () => {
  const at = new Date("2026-12-01T17:00:00Z");
  const occurrenceId = () => randomUUID() as OccurrenceId;

  /** A fresh Household and Ana with every shape of recurrence stored in both, and a recorded 2026-12-01 expense to link one to. */
  const withRent = async () => {
    const f = await fixture();
    const memory = new InMemoryRecurrences();
    const shapes = everyShape(f);
    await storeInBoth(memory, shapes);
    // The fund-paid rent and Pedro's recurrence (Household), Ana's salary (her personal space) and her contribution.
    const [rent, pedros, salary, , contribution] = shapes as [
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
      Recurrence,
    ];
    const expense = unwrap(
      recordExpense({
        id: randomUUID() as TransactionId,
        spaceId: f.household.spaceId,
        date: day("2026-12-01"),
        amount: 120_000_000n,
        currency: "COP",
        createdBy: f.household.userId,
        now: at,
        categoryId: f.groceries,
        payments: [{ memberId: null, accountId: f.fund, amount: 120_000_000n }],
        shares: [{ memberId: f.household.memberId, amount: 120_000_000n, splitMethod: "EQUAL" }],
      }),
    );
    await new DrizzleTransactionRepository(tm).add(expense);
    return { f, memory, rent, pedros, salary, contribution, expense };
  };
  /** What a recurrence's reads ask of the repository. */
  const reads = async (
    source: OccurrenceRepository,
    spaceId: string,
    recurrenceId: string,
    occurrenceId: string,
  ) => [
    await source.findOccurrence(spaceId, occurrenceId),
    await source.pendingOccurrences(spaceId),
    [...(await source.latestOccurrences(spaceId, [recurrenceId]))],
  ];
  /** An occurrence read the way a confirm or a skip reads it: under its lock, inside a transaction. */
  const lockedRead = async (source: OccurrenceRepository, spaceId: string, occurrenceId: string) =>
    unwrap(await tm.run(async () => ok(await source.findOccurrence(spaceId, occurrenceId, { lock: true }))));

  it("stores, resolves and reads occurrences like the in-memory twin", async () => {
    const { f, memory, rent, expense } = await withRent();
    const recorded = recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), expense.id, at);
    const skipped = skippedOccurrence(occurrenceId(), rent, day("2027-01-01"), "PeriodClosed", at);
    const pending = pendingOccurrence(occurrenceId(), rent, day("2027-02-01"), at);
    for (const occurrence of [recorded, skipped, pending]) {
      await repo.addOccurrence(occurrence);
      await memory.addOccurrence(occurrence);
    }
    const space = f.household.spaceId;
    expect(await reads(repo, space, rent.id, pending.id)).toEqual([pending, [pending], [[rent.id, pending]]]);
    expect(await reads(memory, space, rent.id, pending.id)).toEqual(
      await reads(repo, space, rent.id, pending.id),
    );
    const resolved = unwrap(skippedByMember(pending, f.household.userId, at));
    await repo.saveOccurrence(resolved);
    await memory.saveOccurrence(resolved);
    expect(await reads(repo, space, rent.id, pending.id)).toEqual([resolved, [], [[rent.id, resolved]]]);
    expect(await reads(memory, space, rent.id, pending.id)).toEqual(
      await reads(repo, space, rent.id, pending.id),
    );
    expect(await lockedRead(repo, space, recorded.id)).toEqual(recorded);
    expect(await lockedRead(memory, space, recorded.id)).toEqual(recorded);
  });

  it("keeps one occurrence per recurrence and date, and a RECORDED one only with its transaction (Review Focus 1)", async () => {
    const { rent } = await withRent();
    await repo.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at));
    await expect(
      repo.addOccurrence(skippedOccurrence(occurrenceId(), rent, day("2026-12-01"), "PeriodClosed", at)),
    ).rejects.toMatchObject({ cause: { constraint: "recurrence_occurrences_date_uq" } });
    await expect(
      repo.addOccurrence({
        ...pendingOccurrence(occurrenceId(), rent, day("2027-01-01"), at),
        status: "RECORDED",
      }),
    ).rejects.toMatchObject({ cause: { constraint: "recurrence_occurrences_recorded" } });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM recurrence_occurrences WHERE recurrence_id = $1",
      [rent.id],
    );
    expect(rows[0].n).toBe(1);
    const memory = new InMemoryRecurrences();
    await memory.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at));
    await expect(
      memory.addOccurrence(pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at)),
    ).rejects.toThrow(/duplicate occurrence/);
  });

  it("rolls back the whole transaction, the expense it recorded included, when the date already has an occurrence (Review Focus 1)", async () => {
    const { f, memory, rent, expense } = await withRent();
    const first = recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), expense.id, at);
    await repo.addOccurrence(first);
    await memory.addOccurrence(first);
    // A second run of the same date: its own expense, an occurrence of another date, then the duplicate that fails.
    const again = { ...expense, id: randomUUID() as TransactionId };
    const next = pendingOccurrence(occurrenceId(), rent, day("2027-01-01"), at);
    const duplicate = recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), again.id, at);
    await expect(
      tm.run(async () => {
        await new DrizzleTransactionRepository(tm).add(again);
        await repo.addOccurrence(next);
        await repo.addOccurrence(duplicate);
        return ok(undefined);
      }),
    ).rejects.toMatchObject({ cause: { constraint: "recurrence_occurrences_date_uq" } });
    expect([
      await count("transactions", again.id),
      await count("recurrence_occurrences", next.id),
      await count("recurrence_occurrences", duplicate.id),
      await count("transactions", expense.id),
      await count("recurrence_occurrences", first.id),
    ]).toEqual([0, 0, 0, 1, 1]);
    expect(await repo.pendingOccurrences(f.household.spaceId)).toEqual([]);
    // The twin refuses the same date the same way, and keeps the first.
    await expect(memory.addOccurrence(duplicate)).rejects.toThrow(/duplicate occurrence/);
    expect(memory.occurrenceRows).toEqual([first]);
  });

  it("answers null, [] or an empty map for malformed and foreign ids, and never another space's (Review Focus 5)", async () => {
    const { f, memory, rent } = await withRent();
    const pending = pendingOccurrence(occurrenceId(), rent, day("2026-12-01"), at);
    await repo.addOccurrence(pending);
    await memory.addOccurrence(pending);
    const strangers = async (source: OccurrenceRepository) => [
      await source.findOccurrence(f.household.spaceId, "not-a-uuid"),
      await source.findOccurrence("not-a-uuid", pending.id),
      await source.findOccurrence(f.household.spaceId, randomUUID()),
      // Another space's occurrence never answers, locked or not.
      await source.findOccurrence(f.personal.spaceId, pending.id),
      await lockedRead(source, f.household.spaceId, "not-a-uuid"),
      await lockedRead(source, f.personal.spaceId, pending.id),
      await source.pendingOccurrences("not-a-uuid"),
      await source.pendingOccurrences(randomUUID()),
      await source.pendingOccurrences(f.personal.spaceId),
      [...(await source.latestOccurrences("not-a-uuid", [rent.id]))],
      [...(await source.latestOccurrences(f.household.spaceId, ["not-a-uuid"]))],
      [...(await source.latestOccurrences(f.household.spaceId, []))],
      [...(await source.latestOccurrences(f.personal.spaceId, [rent.id]))],
    ];
    expect(await strangers(repo)).toEqual([null, null, null, null, null, null, [], [], [], [], [], [], []]);
    expect(await strangers(memory)).toEqual(await strangers(repo));
  });

  it("lists a space's PENDING occurrences only, earliest date first and ties by id, like the in-memory twin", async () => {
    const { f, memory, rent, pedros, salary, expense } = await withRent();
    const [low, high] = [occurrenceId(), occurrenceId()].sort() as [OccurrenceId, OccurrenceId];
    const lastOne = pendingOccurrence(occurrenceId(), pedros, day("2027-03-01"), at);
    const tiedHigh = pendingOccurrence(high, rent, day("2027-02-01"), at);
    const tiedLow = pendingOccurrence(low, pedros, day("2027-02-01"), at);
    const hers = pendingOccurrence(occurrenceId(), salary, day("2026-11-01"), at);
    // Stored out of order, with the resolved ones and another space's among them.
    const rows = [
      lastOne,
      tiedHigh,
      recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), expense.id, at),
      tiedLow,
      skippedOccurrence(occurrenceId(), pedros, day("2026-12-01"), "PeriodClosed", at),
      hers,
    ];
    for (const occurrence of rows) {
      await repo.addOccurrence(occurrence);
      await memory.addOccurrence(occurrence);
    }
    for (const source of [repo, memory]) {
      expect(await source.pendingOccurrences(f.household.spaceId)).toEqual([tiedLow, tiedHigh, lastOne]);
      expect(await source.pendingOccurrences(f.personal.spaceId)).toEqual([hers]);
    }
  });

  it("answers exactly the latest occurrence of each recurrence, whatever its status or the order it was stored in", async () => {
    const { f, memory, rent, pedros, salary, contribution, expense } = await withRent();
    const rentRecorded = recordedOccurrence(occurrenceId(), rent, day("2026-12-01"), expense.id, at);
    const rentPending = pendingOccurrence(occurrenceId(), rent, day("2027-01-01"), at);
    const rentSkipped = skippedOccurrence(occurrenceId(), rent, day("2027-02-01"), "PeriodClosed", at);
    const pedrosOnly = pendingOccurrence(occurrenceId(), pedros, day("2026-12-01"), at);
    const hers = pendingOccurrence(occurrenceId(), salary, day("2026-11-01"), at);
    // The rent's latest date is stored in the middle, and its status is the least telling.
    for (const occurrence of [rentPending, rentSkipped, rentRecorded, pedrosOnly, hers]) {
      await repo.addOccurrence(occurrence);
      await memory.addOccurrence(occurrence);
    }
    const asked = [rent.id, pedros.id, salary.id, contribution.id, "not-a-uuid"];
    for (const source of [repo, memory]) {
      // The contribution has none, the salary is another space's, and the malformed id is ignored.
      expect(await source.latestOccurrences(f.household.spaceId, asked)).toEqual(
        new Map([
          [rent.id, rentSkipped],
          [pedros.id, pedrosOnly],
        ]),
      );
      expect(await source.latestOccurrences(f.personal.spaceId, asked)).toEqual(new Map([[salary.id, hers]]));
      expect(await source.latestOccurrences(f.household.spaceId, [rent.id])).toEqual(
        new Map([[rent.id, rentSkipped]]),
      );
    }
  });

  it("saves what a confirm or a skip changes, throws for an occurrence no stored one matches by id and space, and deletes nothing (D8)", async () => {
    const { f, memory, rent, pedros, expense } = await withRent();
    const space = f.household.spaceId;
    const toSkip = pendingOccurrence(occurrenceId(), rent, day("2027-02-01"), at);
    const toConfirm = pendingOccurrence(occurrenceId(), rent, day("2027-03-01"), at);
    for (const occurrence of [toSkip, toConfirm]) {
      await repo.addOccurrence(occurrence);
      await memory.addOccurrence(occurrence);
    }
    const skipped = unwrap(skippedByMember(toSkip, f.household.userId, at));
    const confirmed = unwrap(
      confirmedOccurrence(toConfirm, {
        transactionId: expense.id,
        amount: 130_000_000n,
        userId: f.household.userId,
        now: at,
      }),
    );
    // Saved as if someone had also pointed it at another recurrence, date and creation time, which no resolution may do.
    const redirected = {
      ...skipped,
      recurrenceId: pedros.id,
      date: day("2027-04-01"),
      createdAt: new Date(0),
    };
    for (const occurrence of [redirected, confirmed]) {
      await repo.saveOccurrence(occurrence);
      await memory.saveOccurrence(occurrence);
    }
    for (const source of [repo, memory]) {
      expect(await source.findOccurrence(space, toSkip.id)).toEqual(skipped);
      expect(await source.findOccurrence(space, toConfirm.id)).toEqual(confirmed);
    }

    const resolvedLater = { ...skipped, resolvedAt: new Date("2026-12-20T17:00:00Z") };
    const misdirected = [
      // Another space's.
      { ...resolvedLater, spaceId: f.personal.spaceId },
      // One that was never stored.
      { ...resolvedLater, id: occurrenceId() },
    ];
    for (const occurrence of misdirected) {
      const refused = new Error(`occurrence ${occurrence.id} is not stored in its space`);
      await expect(repo.saveOccurrence(occurrence)).rejects.toThrow(refused);
      await expect(memory.saveOccurrence(occurrence)).rejects.toThrow(refused);
    }
    // Inside a transaction the throw rolls back what was saved before it.
    await expect(
      tm.run(async () => {
        await repo.saveOccurrence(resolvedLater);
        await repo.saveOccurrence(misdirected[0]!);
        return ok(undefined);
      }),
    ).rejects.toThrow(/is not stored/);
    expect([
      await repo.findOccurrence(space, toSkip.id),
      await memory.findOccurrence(space, toSkip.id),
    ]).toEqual([skipped, skipped]);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM recurrence_occurrences WHERE space_id = $1",
      [space],
    );
    expect([rows[0].n, memory.occurrenceRows.length]).toEqual([2, 2]);
  });
});
