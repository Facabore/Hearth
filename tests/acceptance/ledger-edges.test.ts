import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import {
  call,
  problemOf,
  registerUser,
  startTestApp,
  type RouteHandler,
  type TestUser,
} from "../support/app";
import {
  balanceOf,
  categoryWithKey,
  cop,
  household,
  inSpace,
  newAccount,
  paysEqually,
  post,
  type MoneyDto,
  type TransactionDto,
} from "../support/ledger";
import { actingIn, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  // A list with no period reads the current one: today is 2026-10-20 in Bogota, never the wall clock (AGENTS.md).
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-20T17:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface LedgerUser extends TestUser {
  bancolombia: string;
  nequi: string;
  groceries: string;
  salary: string;
}

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
const salary = (user: LedgerUser, pesos = 3_000_000, date = "2026-10-25") => ({
  description: "Salary",
  amount: cop(pesos),
  date,
  categoryId: user.salary,
  accountId: user.bancolombia,
});
const toNequi = (user: LedgerUser, pesos = 500_000, date = "2026-10-06") => ({
  amount: cop(pesos),
  date,
  sourceAccountId: user.bancolombia,
  destinationAccountId: user.nequi,
});

const recorded = async (response: Promise<Response>) => (await (await response).json()) as TransactionDto;
const countOf = async (spaceId: string) =>
  (await app.pool.query("SELECT 1 FROM transactions WHERE space_id = $1", [spaceId])).rowCount;

describe("income and transfer refusals and replays over HTTP (HU-E4-02, HU-E4-03, M1 review)", () => {
  it("answers each refusal of an income with its code and records nothing", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const household = actingIn(ana, await newSharedSpace(ana));
    const householdSalary = await categoryWithKey(household, "salary");
    const cases: [TestUser, TestUser, unknown, [number, string]][] = [
      [ana, ana, { ...salary(ana), categoryId: undefined }, [422, "CategoryRequired"]],
      [ana, ana, { ...salary(ana), accountId: juan.bancolombia }, [422, "AccountNotOwned"]],
      // Ana owns Bancolombia, but it lives in her personal space: an income stays inside its own space.
      [household, household, { ...salary(ana), categoryId: householdSalary }, [422, "AccountNotInSpace"]],
      [juan, ana, salary(juan), [404, "SpaceNotFound"]],
    ];
    for (const [user, spaceOf, body, problem] of cases) {
      expect(await problemOf(await post(recordIncome, user, "incomes", body, {}, spaceOf))).toEqual(problem);
    }
    expect([await countOf(ana.spaceId), await countOf(household.spaceId)]).toEqual([0, 0]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
  });

  it("answers each refusal of a transfer with its code and records nothing", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    const household = actingIn(ana, await newSharedSpace(ana));
    const cases: [TestUser, TestUser, unknown, [number, string]][] = [
      [ana, ana, { ...toNequi(ana), destinationAccountId: juan.bancolombia }, [422, "AccountNotOwned"]],
      [ana, ana, { ...toNequi(ana), sourceAccountId: juan.bancolombia }, [422, "AccountNotOwned"]],
      [household, household, toNequi(ana), [422, "AccountNotInSpace"]],
      [juan, ana, toNequi(juan), [404, "SpaceNotFound"]],
    ];
    for (const [user, spaceOf, body, problem] of cases) {
      expect(await problemOf(await post(recordTransfer, user, "transfers", body, {}, spaceOf))).toEqual(
        problem,
      );
    }
    expect([await countOf(ana.spaceId), await countOf(household.spaceId)]).toEqual([0, 0]);
    expect([await balanceOf(ana, ana.bancolombia), await balanceOf(ana, ana.nequi)]).toEqual([
      cop(2_000_000),
      cop(0),
    ]);
  });

  it("replays a repeated Idempotency-Key on an income and on a transfer, and records each once", async () => {
    const ana = await ledgerUser("Ana");
    const twice = async (handler: RouteHandler, resource: string, body: unknown, key: string) => {
      const first = await post(handler, ana, resource, body, { "idempotency-key": key });
      const second = await post(handler, ana, resource, body, { "idempotency-key": key });
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await second.json()).toEqual(await first.json());
    };
    await twice(recordIncome, "incomes", salary(ana), "salary-2026-10");
    await twice(recordTransfer, "transfers", toNequi(ana), "to-nequi-2026-10-06");
    expect(await countOf(ana.spaceId)).toBe(2);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(4_500_000));
    expect(await balanceOf(ana, ana.nequi)).toEqual(cop(500_000));
  });
});

describe("archived and foreign references through the ledger (HU-E2-03, HU-E3-03, M1 review)", () => {
  const archive = (user: TestUser, handler: RouteHandler, resource: string, param: string, id: string) =>
    call(handler, "POST", inSpace(user, `${resource}/${id}/archive`), {
      user,
      params: { spaceId: user.spaceId, [param]: id },
    });

  it("refuses new movements through an archived account, on every kind of movement", async () => {
    const ana = await ledgerUser("Ana");
    expect((await archive(ana, archiveAccount, "accounts", "accountId", ana.nequi)).status).toBe(200);
    expect(
      await problemOf(await post(recordExpense, ana, "expenses", { ...market(ana), accountId: ana.nequi })),
    ).toEqual([409, "AccountArchived"]);
    expect(
      await problemOf(await post(recordIncome, ana, "incomes", { ...salary(ana), accountId: ana.nequi })),
    ).toEqual([409, "AccountArchived"]);
    expect(await problemOf(await post(recordTransfer, ana, "transfers", toNequi(ana)))).toEqual([
      409,
      "AccountArchived",
    ]);
    expect(await countOf(ana.spaceId)).toBe(0);
  });

  it("refuses an archived category on an income, and another space's category as not found", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await ledgerUser("Juan");
    expect((await archive(ana, archiveCategory, "categories", "categoryId", ana.salary)).status).toBe(200);
    expect(await problemOf(await post(recordIncome, ana, "incomes", salary(ana)))).toEqual([
      409,
      "CategoryArchived",
    ]);
    expect(
      await problemOf(
        await post(recordExpense, ana, "expenses", { ...market(ana), categoryId: juan.groceries }),
      ),
    ).toEqual([404, "CategoryNotFound"]);
    expect(
      await problemOf(await post(recordIncome, ana, "incomes", { ...salary(ana), categoryId: juan.salary })),
    ).toEqual([404, "CategoryNotFound"]);
    expect(await countOf(ana.spaceId)).toBe(0);
  });
});

interface PageDto {
  period: { label: string; startDate: string; endDate: string };
  totals: { expenses: MoneyDto; income: MoneyDto };
  items: TransactionDto[];
  nextCursor: string | null;
}

const listOf = async (user: TestUser, query = "") => {
  const response = await call(listTransactions, "GET", inSpace(user, `transactions${query}`), {
    user,
    params: { spaceId: user.spaceId },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PageDto;
};

describe("filters, pages and the default period of the transaction list (HU-E4-04, HU-E4-05, M1 review)", () => {
  it("reads the current period when no period is asked", async () => {
    const ana = await ledgerUser("Ana");
    const october = await recorded(post(recordExpense, ana, "expenses", market(ana, 85_000, "2026-10-05")));
    await post(recordExpense, ana, "expenses", market(ana, 40_000, "2026-11-02"));
    const page = await listOf(ana);
    expect(page.period).toEqual({ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(page.items.map((t) => t.id)).toEqual([october.id]);
  });

  it("filters by type", async () => {
    const ana = await ledgerUser("Ana");
    const expense = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const income = await recorded(post(recordIncome, ana, "incomes", salary(ana)));
    const transfer = await recorded(post(recordTransfer, ana, "transfers", toNequi(ana)));
    const ofType = async (type: string) =>
      (await listOf(ana, `?period=2026-10&type=${type}`)).items.map((t) => t.id);
    expect(await ofType("EXPENSE")).toEqual([expense.id]);
    expect(await ofType("INCOME")).toEqual([income.id]);
    expect(await ofType("TRANSFER")).toEqual([transfer.id]);
    expect(await ofType("SETTLEMENT")).toEqual([]);
    expect((await listOf(ana, "?period=2026-10&type=EXPENSE")).totals).toEqual({
      expenses: cop(85_000),
      income: cop(0),
    });
  });

  it("filters a household's list by payer and by participant", async () => {
    const h = await household();
    const both = await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const anasOwn = await paysEqually(h.ana, 30_000, [h.ana.memberId], h.groceries);
    const juans = await paysEqually(h.juan, 60_000, [h.juan.memberId], h.groceries);
    const ids = async (query: string) =>
      (await listOf(actingIn(h.ana, h.spaceId), `?period=2026-10&${query}`)).items.map((t) => t.id).sort();
    expect(await ids(`payerMemberId=${h.ana.memberId}`)).toEqual([both.id, anasOwn.id].sort());
    expect(await ids(`payerMemberId=${h.juan.memberId}`)).toEqual([juans.id]);
    expect(await ids(`participantMemberId=${h.juan.memberId}`)).toEqual([both.id, juans.id].sort());
    expect(await ids(`participantMemberId=${h.ana.memberId}&payerMemberId=${h.juan.memberId}`)).toEqual([]);
  });

  it("pages through movements of one date without losing or repeating any, totals for the whole period", async () => {
    const ana = await ledgerUser("Ana");
    const sameDay = [];
    for (const pesos of [10_000, 20_000, 30_000, 40_000, 50_000]) {
      sameDay.push(await recorded(post(recordExpense, ana, "expenses", market(ana, pesos, "2026-10-12"))));
    }
    const seen: string[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const page = await listOf(ana, `?period=2026-10&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(page.totals).toEqual({ expenses: cop(150_000), income: cop(0) });
      seen.push(...page.items.map((t) => t.id));
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect([...seen].sort()).toEqual(sameDay.map((t) => t.id).sort());
  });
});

const onTransaction = (
  handler: RouteHandler,
  method: string,
  user: TestUser,
  spaceOf: TestUser,
  id: string,
  options: { body?: unknown; suffix?: string } = {},
) =>
  call(handler, method, inSpace(spaceOf, `transactions/${id}${options.suffix ?? ""}`), {
    user,
    params: { spaceId: spaceOf.spaceId, transactionId: id },
    body: options.body,
  });

describe("edits and deletes at the edges (HU-E4-06, M1 review)", () => {
  it("answers a second DELETE and a PATCH after a soft delete with TransactionNotFound, and audits nothing more", async () => {
    const ana = await ledgerUser("Ana");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect((await onTransaction(deleteTransaction, "DELETE", ana, ana, tx.id)).status).toBe(204);
    expect(await problemOf(await onTransaction(deleteTransaction, "DELETE", ana, ana, tx.id))).toEqual([
      404,
      "TransactionNotFound",
    ]);
    expect(
      await problemOf(
        await onTransaction(editTransaction, "PATCH", ana, ana, tx.id, { body: { description: "Again" } }),
      ),
    ).toEqual([404, "TransactionNotFound"]);
    const audit = await onTransaction(transactionAudit, "GET", ana, ana, tx.id, { suffix: "/audit" });
    expect(((await audit.json()) as { items: { action: string }[] }).items.map((e) => e.action)).toEqual([
      "DELETED",
    ]);
    expect(await balanceOf(ana, ana.bancolombia)).toEqual(cop(2_000_000));
  });

  it("answers each documented 409 and 422 of a PATCH with its code, and changes nothing", async () => {
    const ana = await ledgerUser("Ana");
    const restaurants = await categoryWithKey(ana, "restaurants");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    const transfer = await recorded(post(recordTransfer, ana, "transfers", toNequi(ana)));
    const savings = await newAccount(ana, "Davivienda", 0);
    expect(
      (
        await call(archiveAccount, "POST", inSpace(ana, `accounts/${savings}/archive`), {
          user: ana,
          params: { spaceId: ana.spaceId, accountId: savings },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(archiveCategory, "POST", inSpace(ana, `categories/${restaurants}/archive`), {
          user: ana,
          params: { spaceId: ana.spaceId, categoryId: restaurants },
        })
      ).status,
    ).toBe(200);
    const cases: [string, unknown, [number, string]][] = [
      [tx.id, { categoryId: restaurants }, [409, "CategoryArchived"]],
      [tx.id, { accountId: savings }, [409, "AccountArchived"]],
      [transfer.id, { categoryId: ana.groceries }, [409, "TransferHasNoCategory"]],
      [tx.id, { amount: cop(0) }, [422, "InvalidAmount"]],
      [tx.id, { amount: { amount: "100", currency: "USD" } }, [422, "CurrencyMismatch"]],
      [tx.id, { description: "x".repeat(201) }, [422, "InvalidDescription"]],
      [tx.id, { date: "0000-06-15" }, [422, "InvalidDate"]],
    ];
    for (const [id, body, problem] of cases) {
      const response = await onTransaction(editTransaction, "PATCH", ana, ana, id, { body });
      expect(await problemOf(response), JSON.stringify(body)).toEqual(problem);
    }
    const versions = await app.pool.query("SELECT version FROM transactions WHERE space_id = $1", [
      ana.spaceId,
    ]);
    expect(versions.rows).toEqual([{ version: 1 }, { version: 1 }]);
  });

  it("hides a movement from a non-member who deletes it or reads its audit, and keeps it", async () => {
    const ana = await ledgerUser("Ana");
    const juan = await registerUser("Juan");
    const tx = await recorded(post(recordExpense, ana, "expenses", market(ana)));
    expect(await problemOf(await onTransaction(deleteTransaction, "DELETE", juan, ana, tx.id))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(
      await problemOf(await onTransaction(transactionAudit, "GET", juan, ana, tx.id, { suffix: "/audit" })),
    ).toEqual([404, "SpaceNotFound"]);
    expect((await listOf(ana, "?period=2026-10")).items.map((t) => t.id)).toEqual([tx.id]);
  });
});
