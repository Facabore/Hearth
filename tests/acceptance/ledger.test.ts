import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type RouteHandler, type TestUser } from "../support/app";

interface MoneyDto {
  amount: string;
  currency: string;
}
interface TransactionDto {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: MoneyDto;
  categoryId: string | null;
  payments: { memberId: string | null; accountId: string | null; amount: MoneyDto }[];
  shares: { memberId: string; amount: MoneyDto; splitMethod: string }[];
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  receivingMemberId: string | null;
  createdBy: string;
  version: number;
}
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

const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });
const inSpace = (user: TestUser, resource: string) => `/api/v1/spaces/${user.spaceId}/${resource}`;

const newAccount = async (user: TestUser, name: string, pesos: number) => {
  const response = await call(createAccount, "POST", inSpace(user, "accounts"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, type: "BANK", openingBalance: cop(pesos) },
  });
  return ((await response.json()) as { id: string }).id;
};

const categoryWithKey = async (user: TestUser, key: string) => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return items.flatMap((g) => g.categories).find((c) => c.key === key)!.id;
};

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

const post = (
  handler: RouteHandler,
  user: TestUser,
  resource: string,
  body: unknown,
  headers: Record<string, string> = {},
  spaceOf: TestUser = user,
) =>
  call(handler, "POST", inSpace(spaceOf, resource), {
    user,
    params: { spaceId: spaceOf.spaceId },
    body,
    headers,
  });

const balanceOf = async (user: TestUser, accountId: string) => {
  const response = await call(getAccount, "GET", inSpace(user, `accounts/${accountId}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
  });
  return ((await response.json()) as { balance: MoneyDto }).balance;
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
