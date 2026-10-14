import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  inSpace,
  newAccount,
  post,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";

interface LedgerUser extends TestUser {
  bancolombia: string;
  nequi: string;
  groceries: string;
  salary: string;
}

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** A signed-up user with Bancolombia (2,000,000 COP), Nequi (0 COP) and the seeded categories. */
const ledgerUser = async (name: string): Promise<LedgerUser> => {
  const user = await registerUser(name);
  return {
    ...user,
    bancolombia: await newAccount(user, "Bancolombia", 2_000_000),
    nequi: await newAccount(user, "Nequi", 0),
    groceries: await categoryWithKey(user, "groceries"),
    salary: await categoryWithKey(user, "salary"),
  };
};

const market = (user: LedgerUser, pesos = 85_000, date = "2026-10-05") => ({
  description: "Market",
  amount: cop(pesos),
  date,
  categoryId: user.groceries,
  accountId: user.bancolombia,
});

const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;

describe("record a personal expense (HU-E4-01, @critical)", () => {
  it("records an expense with one payment and one share for Ana", async () => {
    const ana = await ledgerUser("Ana");
    const response = await post(recordExpense, ana, "expenses", market(ana));
    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe('"1"');
    const body = (await response.json()) as TransactionDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${ana.spaceId}/transactions/${body.id}`);
    expect(body).toMatchObject({
      type: "EXPENSE",
      description: "Market",
      date: "2026-10-05",
      amount: cop(85_000),
      categoryId: ana.groceries,
      createdBy: ana.userId,
      version: 1,
    });
    expect(body.payments).toEqual([
      { memberId: expect.any(String), accountId: ana.bancolombia, amount: cop(85_000) },
    ]);
    expect(body.shares).toEqual([
      { memberId: body.payments[0]!.memberId, amount: cop(85_000), splitMethod: "EQUAL" },
    ]);
  });

  it("replays a repeated Idempotency-Key and records the expense once", async () => {
    const ana = await ledgerUser("Ana");
    const key = { "idempotency-key": "market-2026-10-05" };
    const first = await post(recordExpense, ana, "expenses", market(ana), key);
    const second = await post(recordExpense, ana, "expenses", market(ana), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
  });

  it("answers invalid input with stable codes", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const cases: [unknown, number, string][] = [
      [{ ...market(ana), amount: cop(0) }, 422, "InvalidAmount"],
      [{ ...market(ana), amount: cop(-10_000) }, 422, "InvalidAmount"],
      [{ ...market(ana), categoryId: undefined }, 422, "CategoryRequired"],
      [{ ...market(ana), accountId: juan.bancolombia }, 422, "AccountNotOwned"],
      [{ ...market(ana), date: "2026-02-30" }, 422, "ValidationFailed"],
      [{ ...market(ana), accountId: "not-a-uuid" }, 404, "AccountNotFound"],
    ];
    for (const [body, status, code] of cases) {
      const response = await post(recordExpense, ana, "expenses", body);
      expect([response.status, (await response.json()).code]).toEqual([status, code]);
    }
  });

  it("hides Ana's space from Juan (Review Focus 4)", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const response = await post(recordExpense, juan, "expenses", market(juan), {}, ana);
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});

describe("income, transfers and computed balances (HU-E4-02, HU-E4-03, HU-E2-04)", () => {
  it("records income, an expense and a transfer and computes both balances", async () => {
    const ana = await ledgerUser("Ana");
    const salary = await recorded(
      post(recordIncome, ana, "incomes", {
        description: "Salary October",
        amount: cop(3_000_000),
        date: "2026-10-25",
        categoryId: ana.salary,
        accountId: ana.bancolombia,
      }),
    );
    expect(salary).toMatchObject({
      type: "INCOME",
      destinationAccountId: ana.bancolombia,
      receivingMemberId: expect.any(String),
    });
    await post(recordExpense, ana, "expenses", market(ana));
    const transfer = await recorded(
      post(recordTransfer, ana, "transfers", {
        amount: cop(500_000),
        date: "2026-10-06",
        sourceAccountId: ana.bancolombia,
        destinationAccountId: ana.nequi,
      }),
    );
    expect(transfer).toMatchObject({ type: "TRANSFER", categoryId: null });
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(4_415_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(500_000));
  });

  it("rejects a transfer to the same account", async () => {
    const ana = await ledgerUser("Ana");
    const response = await post(recordTransfer, ana, "transfers", {
      amount: cop(500_000),
      sourceAccountId: ana.bancolombia,
      destinationAccountId: ana.bancolombia,
    });
    expect([response.status, (await response.json()).code]).toEqual([409, "SameAccountTransfer"]);
  });
});

interface PageDto {
  period: { label: string; startDate: string; endDate: string };
  totals: { expenses: MoneyDto; income: MoneyDto };
  items: TransactionDto[];
  nextCursor: string | null;
  code?: string;
}

const listOf = async (user: TestUser, query: string) => {
  const response = await call(listTransactions, "GET", inSpace(user, `transactions${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  return { status: response.status, body: (await response.json()) as PageDto };
};

describe("monthly transaction list (HU-E4-04, HU-E4-05)", () => {
  it("lists a period newest first with totals, filters by category and pages with a cursor", async () => {
    const ana = await ledgerUser("Ana");
    const restaurants = await categoryWithKey(ana, "restaurants");
    await post(recordExpense, ana, "expenses", market(ana, 85_000, "2026-10-05"));
    await post(recordExpense, ana, "expenses", market(ana, 100_000, "2026-10-12"));
    await post(recordExpense, ana, "expenses", {
      ...market(ana, 60_000, "2026-10-15"),
      description: "Dinner",
      categoryId: restaurants,
    });
    await post(recordIncome, ana, "incomes", {
      description: "Salary",
      amount: cop(3_200_000),
      date: "2026-10-25",
      categoryId: ana.salary,
      accountId: ana.bancolombia,
    });

    const { body: page } = await listOf(ana, "?period=2026-10");
    expect(page.period).toEqual({ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(page.items.map((t) => t.date)).toEqual(["2026-10-25", "2026-10-15", "2026-10-12", "2026-10-05"]);
    expect(page.totals).toEqual({ expenses: cop(245_000), income: cop(3_200_000) });

    const { body: groceries } = await listOf(ana, `?period=2026-10&categoryIds=${ana.groceries}`);
    expect(groceries.items).toHaveLength(2);
    expect(groceries.totals.expenses).toEqual(cop(185_000));

    const { body: first } = await listOf(ana, "?period=2026-10&limit=3");
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const { body: rest } = await listOf(ana, `?period=2026-10&limit=3&cursor=${first.nextCursor}`);
    expect(rest.items.map((t) => t.date)).toEqual(["2026-10-05"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("resolves URL-encoded semi-monthly labels", async () => {
    const ana = await ledgerUser("Ana");
    await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } },
    });
    await post(recordExpense, ana, "expenses", market(ana, 70_000, "2026-11-10"));
    await post(recordExpense, ana, "expenses", market(ana, 50_000, "2026-11-20"));
    const { body: firstHalf } = await listOf(ana, "?period=2026-11%20H1");
    expect(firstHalf.period).toEqual({ label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" });
    expect(firstHalf.totals.expenses).toEqual(cop(70_000));
    const { body: secondHalf } = await listOf(ana, "?period=2026-11%20H2");
    expect(secondHalf.totals.expenses).toEqual(cop(50_000));
  });

  it("keeps listing the transactions of an archived account (HU-E2-03)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", { ...market(ana), accountId: ana.nequi }));
    await call(archiveAccount, "POST", inSpace(ana, `accounts/${ana.nequi}/archive`), {
      user: ana,
      params: { spaceId: ana.spaceId, accountId: ana.nequi },
    });
    expect((await listOf(ana, "?period=2026-10")).body.items.map((t) => t.id)).toEqual([tx.id]);
  });

  it("rejects malformed cursors, labels and filters with 422 (Review Focus 4)", async () => {
    const ana = await ledgerUser("Ana");
    const nonUuidCursor = Buffer.from(JSON.stringify(["2026-10-05", "not-a-uuid"]), "utf8").toString(
      "base64url",
    );
    const cases: [string, string][] = [
      ["?cursor=garbage!!", "InvalidCursor"],
      [`?cursor=${nonUuidCursor}`, "InvalidCursor"],
      ["?period=2026-13", "InvalidPeriodLabel"],
      ["?categoryIds=nope", "ValidationFailed"],
      ["?limit=201", "ValidationFailed"],
    ];
    for (const [query, code] of cases) {
      expect(await listOf(ana, query)).toMatchObject({ status: 422, body: { code } });
    }
  });

  it("returns one transaction with its ETag and hides foreign and malformed ids", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const get = (user: TestUser, spaceOf: TestUser, id: string) =>
      call(getTransaction, "GET", inSpace(spaceOf, `transactions/${id}`), {
        user,
        params: { spaceId: spaceOf.spaceId, transactionId: id },
      });
    const own = await get(ana, ana, tx.id);
    expect([own.status, own.headers.get("etag")]).toEqual([200, '"1"']);
    expect((await (await get(juan, ana, tx.id)).json()).code).toBe("SpaceNotFound");
    expect((await (await get(juan, juan, tx.id)).json()).code).toBe("TransactionNotFound");
    expect((await (await get(ana, ana, "not-a-uuid")).json()).code).toBe("TransactionNotFound");
  });
});

interface AuditDto {
  action: string;
  actorUserId: string;
  at: string;
  changes: Record<string, { from: string | null; to: string | null }>;
}

const onTransaction = (
  handler: RouteHandler,
  method: string,
  user: TestUser,
  id: string,
  options: { body?: unknown; ifMatch?: string; suffix?: string } = {},
) =>
  call(handler, method, inSpace(user, `transactions/${id}${options.suffix ?? ""}`), {
    user,
    params: { spaceId: user.spaceId, transactionId: id },
    body: options.body,
    headers: options.ifMatch === undefined ? {} : { "if-match": options.ifMatch },
  });
const auditOf = async (user: TestUser, id: string) =>
  (
    (await (await onTransaction(transactionAudit, "GET", user, id, { suffix: "/audit" })).json()) as {
      items: AuditDto[];
    }
  ).items;

describe("edit and delete with an audit trail (HU-E4-06)", () => {
  it("edits the amount with If-Match, returns the next ETag and audits the change", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
      body: { amount: cop(95_000) },
      ifMatch: '"1"',
    });
    expect([response.status, response.headers.get("etag")]).toEqual([200, '"2"']);
    const edited = (await response.json()) as TransactionDto;
    expect(edited.amount).toEqual(cop(95_000));
    expect(edited.payments.map((p) => p.amount)).toEqual([cop(95_000)]);
    expect(edited.shares.map((s) => s.amount)).toEqual([cop(95_000)]);
    expect(await auditOf(ana, tx.id)).toEqual([
      expect.objectContaining({
        action: "UPDATED",
        actorUserId: ana.userId,
        at: expect.any(String),
        // Task 0b: the parts that followed the amount are pinned in "the audit keeps every payment and share".
        changes: expect.objectContaining({ amount: { from: "8500000", to: "9500000" } }),
      }),
    ]);
  });

  it("rejects a stale or malformed If-Match with 412 and changes nothing (Review Focus 1)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect(
      (
        await onTransaction(editTransaction, "PATCH", ana, tx.id, {
          body: { description: "Groceries" },
          ifMatch: '"1"',
        })
      ).status,
    ).toBe(200);
    for (const ifMatch of ['"1"', "abc"]) {
      const stale = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
        body: { amount: cop(1_000) },
        ifMatch,
      });
      expect([stale.status, (await stale.json()).code]).toEqual([412, "PreconditionFailed"]);
    }
    const current = (await (await onTransaction(getTransaction, "GET", ana, tx.id)).json()) as TransactionDto;
    expect([current.amount, current.description, current.version]).toEqual([cop(85_000), "Groceries", 2]);
    expect(await auditOf(ana, tx.id)).toHaveLength(1);
  });

  it("soft-deletes: gone from lists and balances, still audited (HU-E2-04)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(1_915_000));
    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    expect((await (await onTransaction(getTransaction, "GET", ana, tx.id)).json()).code).toBe(
      "TransactionNotFound",
    );
    expect((await listOf(ana, "?period=2026-10")).body.items).toEqual([]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
    expect((await auditOf(ana, tx.id)).map((e) => [e.action, e.actorUserId])).toEqual([
      ["DELETED", ana.userId],
    ]);
  });

  it("moves a transaction to another period when its date changes (HU-E4-04)", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana, 85_000, "2026-10-31")));
    await onTransaction(editTransaction, "PATCH", ana, tx.id, { body: { date: "2026-11-02" } });
    expect((await listOf(ana, "?period=2026-11")).body.items.map((t) => t.id)).toEqual([tx.id]);
    expect((await listOf(ana, "?period=2026-10")).body.items).toEqual([]);
  });

  it("hides other users' transactions", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await call(editTransaction, "PATCH", inSpace(ana, `transactions/${tx.id}`), {
      user: juan,
      params: { spaceId: ana.spaceId, transactionId: tx.id },
      body: { description: "Mine" },
    });
    expect([response.status, (await response.json()).code]).toEqual([404, "SpaceNotFound"]);
  });
});

describe("dates outside the supported years (Review Focus 4)", () => {
  it("answers year-0000 and two-digit-year inputs with 422, never 500", async () => {
    const ana = await ledgerUser("Ana");
    const expense = await post(recordExpense, ana, "expenses", market(ana, 85_000, "0000-06-15"));
    expect([expense.status, (await expense.json()).code]).toEqual([422, "InvalidDate"]);
    const balance = await call(
      getAccount,
      "GET",
      inSpace(ana, `accounts/${ana.bancolombia}?asOf=0000-01-01`),
      {
        user: ana,
        params: { spaceId: ana.spaceId, accountId: ana.bancolombia },
      },
    );
    expect([balance.status, (await balance.json()).code]).toEqual([422, "InvalidDate"]);
    for (const period of ["0000-01", "0050-03"]) {
      expect(await listOf(ana, `?period=${period}`)).toMatchObject({
        status: 422,
        body: { code: "InvalidPeriodLabel" },
      });
    }
  });
});

describe("the audit keeps every payment and share (D8, Task 0b)", () => {
  const partsOf = (tx: TransactionDto) => ({
    payments: JSON.stringify(
      tx.payments.map((p) => ({ memberId: p.memberId, accountId: p.accountId, amount: p.amount.amount })),
    ),
    shares: JSON.stringify(
      tx.shares.map((s) => ({ memberId: s.memberId, amount: s.amount.amount, splitMethod: s.splitMethod })),
    ),
  });

  it("returns the split an edit replaced and the whole version a deletion retired", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const response = await onTransaction(editTransaction, "PATCH", ana, tx.id, {
      body: { amount: cop(95_000) },
    });
    const edited = (await response.json()) as TransactionDto;
    expect((await onTransaction(deleteTransaction, "DELETE", ana, tx.id)).status).toBe(204);
    const [before, after] = [partsOf(tx), partsOf(edited)];
    expect(JSON.parse(before.payments)).toEqual([
      { memberId: tx.payments[0]!.memberId, accountId: ana.bancolombia, amount: "8500000" },
    ]);
    expect((await auditOf(ana, tx.id)).map((e) => [e.action, e.changes])).toEqual([
      [
        "UPDATED",
        {
          amount: { from: "8500000", to: "9500000" },
          payments: { from: before.payments, to: after.payments },
          shares: { from: before.shares, to: after.shares },
        },
      ],
      [
        "DELETED",
        {
          description: { from: "Market", to: null },
          date: { from: "2026-10-05", to: null },
          categoryId: { from: ana.groceries, to: null },
          amount: { from: "9500000", to: null },
          payments: { from: after.payments, to: null },
          shares: { from: after.shares, to: null },
        },
      ],
    ]);
  });
});
