import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  sharedLedgerFixture,
} from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

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
