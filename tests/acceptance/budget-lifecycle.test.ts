import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  activatePlan,
  closePlan,
  deleteLine,
  getPlan,
  newPlan,
  patchLine,
  planOf,
  postLine,
  putAllocation,
  putCapacities,
  putCategories,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import {
  categoryWithKey,
  cop,
  joinHousehold,
  newAccount,
  post,
  type HouseholdMember,
} from "../support/ledger";

/** 2027-01-15 at noon in Bogota: after the 2026-11 and 2026-12 periods ended, in the middle of 2027-01. */
const NOW = new Date("2027-01-15T17:00:00Z");

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Activates the plan and returns it; fails the test unless 200. */
const activated = async (...args: Parameters<typeof activatePlan>): Promise<PlanDto> => {
  const response = await activatePlan(...args);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanDto;
};

/** HU-E1-09: `owner` archives the space; nothing was recorded, so every balance is settled. */
const archive = async (owner: Parameters<typeof activatePlan>[0], spaceId: string) => {
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, {
    user: owner,
    params: { spaceId },
  });
  expect(archived.status).toBe(204);
};

/** The plan's status and ETag as `user` reads them now: a refused activation must leave both as they were. */
const statusAndEtag = async (...args: Parameters<typeof getPlan>) => {
  const response = await getPlan(...args);
  expect(response.status).toBe(200);
  return [((await response.json()) as PlanDto).status, response.headers.get("etag")];
};

/** The members of a problem body, sorted: its whole public shape. */
const keysOf = async (response: Response) => Object.keys(await response.json()).sort();

describe("activating a plan (HU-E6-07)", () => {
  it("activates the valid reference plan and answers it with its new ETag", async () => {
    const { h, planId, plan } = await referencePlan();
    const response = await activatePlan(h.ana, h.spaceId, planId, plan.version);
    expect([response.status, response.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    const body = (await response.json()) as PlanDto;
    expect([body.status, body.version, body.lines.length]).toEqual(["ACTIVE", plan.version + 1, 4]);
    expect((await planOf(h.juan, h.spaceId, planId)).status).toBe("ACTIVE");
  });

  it("refuses a plan whose Free percentages sum to 99 % once Luis left, naming Free and nothing else (Review Focus 3)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const free = lineId("Free");
    const split = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "57" },
        { memberId: luis.memberId, percent: "1" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, free, split)).status).toBe(200);
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: luis,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
    const before = await statusAndEtag(h.ana, h.spaceId, planId);
    const response = await activatePlan(h.ana, h.spaceId, planId);
    expect(response.status).toBe(422);
    // The public shape: the standard members plus lineIds, never the private reason or any other detail.
    expect(await keysOf(response.clone())).toEqual([
      "code",
      "lineIds",
      "requestId",
      "status",
      "title",
      "type",
    ]);
    expect(await response.json()).toMatchObject({ code: "InvalidAllocation", lineIds: [free] });
    expect(await statusAndEtag(h.ana, h.spaceId, planId)).toEqual(before);
    expect(before[0]).toBe("DRAFT");
  });

  it("keeps the reason of AllocateBudgetLine's InvalidAllocation private: no lineIds, no reason", async () => {
    const { h, planId, lineId } = await referencePlan();
    const notHundred = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "57" },
      ],
    };
    const response = await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), notHundred);
    expect(response.status).toBe(422);
    expect(await keysOf(response.clone())).toEqual(["code", "requestId", "status", "title", "type"]);
    expect(await response.json()).toMatchObject({ code: "InvalidAllocation" });
  });

  it("refuses a plan whose capacity was reduced below its lines: Juan at 2,000,000 COP", async () => {
    const { h, planId } = await referencePlan();
    await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    const before = await statusAndEtag(h.ana, h.spaceId, planId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "PlanExceedsCapacity",
    ]);
    expect(await statusAndEtag(h.ana, h.spaceId, planId)).toEqual(before);
    expect(before[0]).toBe("DRAFT");
  });

  it("activates only a DRAFT plan, only for owners and admins, and honours If-Match", async () => {
    const { h, planId, plan } = await referencePlan();
    const sofi = await joinHousehold(h, "Sofi", "ADMIN");
    expect(await problemOf(await activatePlan(h.juan, h.spaceId, planId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId, plan.version + 5))).toEqual([
      412,
      "PreconditionFailed",
    ]);
    // An ADMIN activates it as well as the OWNER (the first scenario).
    expect((await activated(sofi, h.spaceId, planId)).status).toBe("ACTIVE");
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "InvalidPlanTransition",
    ]);
  });

  it("answers BudgetPlanNotFound for unknown and malformed plan ids, SpaceNotFound to a stranger, and SpaceArchived in an archived space", async () => {
    const { h, planId } = await referencePlan();
    const marta = await registerUser("Marta");
    expect(await problemOf(await activatePlan(marta, h.spaceId, planId))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(
      await problemOf(await activatePlan(h.ana, h.spaceId, "0190a0a0-0000-7000-8000-000000000000")),
    ).toEqual([404, "BudgetPlanNotFound"]);
    await archive(h.ana, h.spaceId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("DRAFT");
  });
});

/** `payer` pays `pesos` of groceries on `date` from their own account, split by default. */
const spend = (payer: HouseholdMember, categoryId: string, pesos: number, date: string) =>
  post(recordExpense, payer, "expenses", {
    description: "Market",
    date,
    categoryId,
    amount: cop(pesos),
    accountId: payer.account,
  });
const idOf = async (response: Response) => {
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The reference plan with expenses on 2026-11-03 and 2026-12-02, then activated and closed. */
const closedReference = async () => {
  const ref = await referencePlan();
  const { h, planId } = ref;
  const november = await idOf(await spend(h.ana, h.groceries, 85_000, "2026-11-03"));
  const december = await idOf(await spend(h.ana, h.groceries, 40_000, "2026-12-02"));
  await activated(h.ana, h.spaceId, planId);
  const response = await closePlan(h.ana, h.spaceId, planId);
  expect(response.status).toBe(200);
  const plan = (await response.json()) as PlanDto;
  expect([plan.status, response.headers.get("etag")]).toEqual(["CLOSED", `"${plan.version}"`]);
  const transaction = (id: string) => `/api/v1/spaces/${h.spaceId}/transactions/${id}`;
  const edit = (id: string, body: unknown) =>
    call(editTransaction, "PATCH", transaction(id), {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
      body,
    });
  const remove = (id: string) =>
    call(deleteTransaction, "DELETE", transaction(id), {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: id },
    });
  return { ...ref, plan, november, december, edit, remove };
};

/** The transactions of `user`'s space in both months: a refused write must leave them as they were. */
const ledgerOf = (user: TestUser) =>
  Promise.all(
    ["2026-11", "2026-12"].map(async (period) => {
      const response = await call(
        listTransactions,
        "GET",
        `/api/v1/spaces/${user.spaceId}/transactions?period=${period}`,
        { user, params: { spaceId: user.spaceId } },
      );
      expect(response.status).toBe(200);
      return response.json();
    }),
  );

type Write = [what: string, write: () => Promise<Response>];
/** The status and problem code of an answer; a delete that succeeds has no body, so a wrongly accepted one reads 204. */
const answerOf = async (response: Response): Promise<[number, string | undefined]> => {
  const body = await response.text();
  return [response.status, body === "" ? undefined : (JSON.parse(body) as { code?: string }).code];
};
/** HU-E4-06: each write answers 409 PeriodClosed, and the ledger of `user`'s space reads as it did before. */
const refusedAsClosed = async (user: TestUser, writes: Write[]) => {
  const before = await ledgerOf(user);
  const answers: [string, ...[number, string | undefined]][] = [];
  for (const [what, write] of writes) answers.push([what, ...(await answerOf(await write()))]);
  expect(answers).toEqual(writes.map(([what]) => [what, 409, "PeriodClosed"]));
  expect(await ledgerOf(user)).toEqual(before);
};
/** The same writes, dated outside the period, are recorded: only their date was refused. */
const recordedOutside = async (records: [string, (date: string) => Promise<Response>][]) => {
  for (const [what, record] of records)
    expect([what, (await record("2026-12-05")).status]).toEqual([what, 201]);
};

describe("closing a plan (HU-E6-07)", () => {
  it("closes an ACTIVE plan, after which its period's transactions no longer change (@critical, HU-E4-06)", async () => {
    const { h, november, december, edit, remove } = await closedReference();
    expect(await problemOf(await spend(h.ana, h.groceries, 50_000, "2026-11-15"))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect(await problemOf(await spend(h.juan, h.groceries, 50_000, "2026-11-30"))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect(await problemOf(await spend(h.juan, h.groceries, 50_000, "2026-11-01"))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect(await problemOf(await edit(november, { description: "Market, corrected" }))).toEqual([
      409,
      "PeriodClosed",
    ]);
    expect(await problemOf(await remove(november))).toEqual([409, "PeriodClosed"]);
    expect(await problemOf(await edit(december, { date: "2026-11-20" }))).toEqual([409, "PeriodClosed"]);
    await idOf(await spend(h.ana, h.groceries, 50_000, "2026-12-01"));
    await idOf(await spend(h.ana, h.groceries, 50_000, "2026-10-31"));
  });

  it("refuses every kind of ledger write inside the period with 409 PeriodClosed, and changes nothing (HU-E4-06)", async () => {
    const { h, november, december, edit, remove } = await closedReference();
    const fund = await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND");
    // Every write of a shared space that records a transaction on a date, as a function of that date.
    const records: [string, (date: string) => Promise<Response>][] = [
      ["record an expense", (date) => spend(h.ana, h.groceries, 50_000, date)],
      [
        "contribute to the fund",
        (date) =>
          post(recordContribution, h.ana, "fund-contributions", {
            date,
            amount: cop(50_000),
            fundAccountId: fund,
            sourceAccountId: h.ana.account,
          }),
      ],
      [
        "record a settlement",
        (date) =>
          post(recordSettlement, h.juan, "settlements", {
            date,
            amount: cop(50_000),
            payerMemberId: h.juan.memberId,
            receivingMemberId: h.ana.memberId,
          }),
      ],
    ];
    await refusedAsClosed(h.ana, [
      ...records.map(([what, record]): Write => [what, () => record("2026-11-15")]),
      ["edit an expense of the period", () => edit(november, { description: "Market, corrected" })],
      ["change the amount of an expense of the period", () => edit(november, { amount: cop(60_000) })],
      ["move an expense out of the period", () => edit(november, { date: "2026-12-10" })],
      ["move an expense into the period", () => edit(december, { date: "2026-11-20" })],
      ["delete an expense of the period", () => remove(november)],
    ]);
    await recordedOutside(records);
  });

  it("freezes income and transfers too, which only a personal space records, when its own plan is CLOSED (HU-E4-06)", async () => {
    const ana = await registerUser("Ana");
    const bank = await newAccount(ana, "Bancolombia", 1_000_000);
    const nequi = await newAccount(ana, "Nequi", 0);
    const [groceries, salary] = [
      await categoryWithKey(ana, "groceries"),
      await categoryWithKey(ana, "salary"),
    ];
    const { id: planId } = await newPlan(ana, ana.spaceId, "2026-11");
    await activated(ana, ana.spaceId, planId);
    expect((await closePlan(ana, ana.spaceId, planId)).status).toBe(200);
    const entry = { amount: cop(50_000), accountId: bank };
    const records: [string, (date: string) => Promise<Response>][] = [
      [
        "record an expense",
        (date) => post(recordExpense, ana, "expenses", { ...entry, date, categoryId: groceries }),
      ],
      ["record income", (date) => post(recordIncome, ana, "incomes", { ...entry, date, categoryId: salary })],
      [
        "record a transfer",
        (date) =>
          post(recordTransfer, ana, "transfers", {
            date,
            amount: cop(50_000),
            sourceAccountId: bank,
            destinationAccountId: nequi,
          }),
      ],
    ];
    await refusedAsClosed(
      ana,
      records.map(([what, record]): Write => [what, () => record("2026-11-15")]),
    );
    await recordedOutside(records);
  });

  it("freezes only the closed plan's space: another space's ledger and a transfer into a SAVINGS line's account go on (ruling P19)", async () => {
    const { h, planId, savings, plan, lineId } = await closedReference();
    const spentOnSavings = (p: PlanDto) => p.lines.find((l) => l.id === lineId("Savings"))!.spent;
    expect(spentOnSavings(plan)).toEqual(cop(0));
    // Ana's personal space has no plan: November is open there.
    const coffee = await categoryWithKey(h.ana.personal, "groceries");
    await idOf(
      await post(recordExpense, h.ana.personal, "expenses", {
        description: "Coffee",
        date: "2026-11-15",
        categoryId: coffee,
        amount: cop(10_000),
        accountId: h.ana.account,
      }),
    );
    const saved = await post(recordTransfer, h.ana.personal, "transfers", {
      date: "2026-11-20",
      amount: cop(100_000),
      sourceAccountId: h.ana.account,
      destinationAccountId: savings,
    });
    expect(saved.status).toBe(201);
    // The closed plan derives its figures on read, so the line's spent moves while the plan itself stays as closed.
    const after = await planOf(h.ana, h.spaceId, planId);
    expect(spentOnSavings(after)).toEqual(cop(100_000));
    expect([after.status, after.version]).toEqual(["CLOSED", plan.version]);
  });

  it("refuses every edit of a CLOSED plan with 409 PeriodClosed, and changes nothing", async () => {
    const { h, planId, lineId, plan } = await closedReference();
    const home = lineId("Home");
    const writes: [string, () => Promise<Response>][] = [
      ["set capacities", () => putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1]])],
      ["add a line", () => postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 1 })],
      ["edit a line", () => patchLine(h.ana, h.spaceId, planId, home, { pesos: 1_500_000 })],
      ["remove a line", () => deleteLine(h.ana, h.spaceId, planId, home)],
      ["map categories", () => putCategories(h.ana, h.spaceId, planId, home, [h.groceries])],
      ["allocate a line", () => putAllocation(h.ana, h.spaceId, planId, home, { rule: "NONE" })],
    ];
    const answers: [string, number, string][] = [];
    for (const [what, write] of writes) answers.push([what, ...(await problemOf(await write()))]);
    expect(answers).toEqual(writes.map(([what]) => [what, 409, "PeriodClosed"]));
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "InvalidPlanTransition",
    ]);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "InvalidPlanTransition",
    ]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    expect((await getPlan(h.ana, h.spaceId, planId)).headers.get("etag")).toBe(`"${plan.version}"`);
  });

  it("refuses to close a plan whose period has not ended with 409 PeriodNotOver, and changes nothing (P17 amended)", async () => {
    // The clock reads 2027-01-15, so the plan of 2027-01 (until 2027-01-31) is the current period, still open.
    const ana = await registerUser("Ana");
    const { id: planId } = await newPlan(ana, ana.spaceId, "2027-01");
    await activated(ana, ana.spaceId, planId);
    const before = await statusAndEtag(ana, ana.spaceId, planId);
    expect(before[0]).toBe("ACTIVE");
    expect(await problemOf(await closePlan(ana, ana.spaceId, planId))).toEqual([409, "PeriodNotOver"]);
    expect(await statusAndEtag(ana, ana.spaceId, planId)).toEqual(before);
    // Nothing was frozen: the rest of the period still records.
    const bank = await newAccount(ana, "Bancolombia", 1_000_000);
    const groceries = await categoryWithKey(ana, "groceries");
    const spent = await post(recordExpense, ana, "expenses", {
      description: "Market",
      date: "2027-01-20",
      categoryId: groceries,
      amount: cop(50_000),
      accountId: bank,
    });
    expect(spent.status).toBe(201);
  });

  it("closes only an ACTIVE plan, only for owners and admins", async () => {
    const { h, planId } = await referencePlan();
    const sofi = await joinHousehold(h, "Sofi", "ADMIN");
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "InvalidPlanTransition",
    ]);
    await activated(h.ana, h.spaceId, planId);
    expect(await problemOf(await closePlan(h.juan, h.spaceId, planId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId, 1))).toEqual([
      412,
      "PreconditionFailed",
    ]);
    // An ADMIN closes it as well as the OWNER (the scenarios above).
    const response = await closePlan(sofi, h.spaceId, planId);
    expect(response.status).toBe(200);
    const closed = (await response.json()) as PlanDto;
    expect([closed.status, response.headers.get("etag")]).toEqual(["CLOSED", `"${closed.version}"`]);
  });

  it("answers BudgetPlanNotFound for unknown and malformed plan ids and SpaceNotFound to a stranger", async () => {
    const { h, planId } = await referencePlan();
    await activated(h.ana, h.spaceId, planId);
    const marta = await registerUser("Marta");
    expect(await problemOf(await closePlan(marta, h.spaceId, planId))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(
      await problemOf(await closePlan(h.ana, h.spaceId, "0190a0a0-0000-7000-8000-000000000000")),
    ).toEqual([404, "BudgetPlanNotFound"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("ACTIVE");
  });

  it("refuses to close in an archived space (HU-E1-09)", async () => {
    const { h, planId } = await referencePlan();
    await activated(h.ana, h.spaceId, planId);
    await archive(h.ana, h.spaceId);
    expect(await problemOf(await closePlan(h.ana, h.spaceId, planId))).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("ACTIVE");
  });
});
