import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  addLine,
  lineNamed,
  newPlan,
  planOf,
  plansPath,
  postLine,
  referencePlan,
  setCapacities,
} from "../support/budgeting";
import { cop, household, joinHousehold, newAccount } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E6-03 Background: a DRAFT plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const background = async () => {
  const h = await household();
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  await setCapacities(h.ana, h.spaceId, planId, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  return { h, planId };
};

/** A POST with an arbitrary body, for requests the typed helper cannot build. */
const postRaw = (h: Awaited<ReturnType<typeof household>>, planId: string, body: unknown) =>
  call(postLineRoute, "POST", plansPath(h.spaceId, `/${planId}/lines`), {
    user: h.ana,
    params: { spaceId: h.spaceId, planId },
    body,
  });

/** What a refusal tells the caller, without its per-request id. */
const disclosed = async (response: Response) => {
  const problem = await response.json();
  return [response.status, problem.type, problem.title, problem.code, problem.errors];
};

describe("budget lines and unallocated capacity (HU-E6-03)", () => {
  it("reports 1,330,000 COP unallocated after Rent and Home, with Home at 36.75 % (golden)", async () => {
    const { h, planId } = await background();
    await addLine(h.ana, h.spaceId, planId, {
      name: "Rent",
      pesos: 1_200_000,
      funding: "SHARED_FUND",
      rolloverMode: "RESET",
    });
    const response = await postLine(h.ana, h.spaceId, planId, {
      name: "Home",
      pesos: 1_470_000,
      funding: "DIRECT",
      rolloverMode: "RESET",
    });
    expect([response.status, response.headers.get("etag")]).toEqual([201, '"4"']);
    const plan = await response.json();
    expect(plan.unallocated).toEqual(cop(1_330_000));
    expect(lineNamed(plan, "Home")).toMatchObject({
      plannedAmount: cop(1_470_000),
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      capacityShare: "36.75",
      spent: cop(0),
      available: cop(1_470_000),
    });
  });

  it("leaves nothing unallocated with the full reference plan, and refuses Travel past it (golden)", async () => {
    const { h, planId, plan } = await referencePlan();
    expect(plan.unallocated).toEqual(cop(0));
    expect(plan.lines.map((l) => [l.name, l.capacityShare])).toEqual([
      ["Rent", "30.00"],
      ["Home", "36.75"],
      ["Savings", "15.00"],
      ["Free", "18.25"],
    ]);
    const travel = await postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 100_000 });
    expect(await problemOf(travel)).toEqual([409, "PlanExceedsCapacity"]);
  });

  it("answers the whole plan with DIRECT and RESET unless told otherwise, and keeps it", async () => {
    const { h, planId } = await background();
    const response = await postLine(h.ana, h.spaceId, planId, { name: "Food", pesos: 500_000 }, 2);
    expect([response.status, response.headers.get("etag")]).toEqual([201, '"3"']);
    const plan = await response.json();
    expect(plan.version).toBe(3);
    expect(lineNamed(plan, "Food")).toMatchObject({
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
      categoryIds: [],
      allocation: { rule: "PROPORTIONAL", error: null },
    });
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("keeps line names unique within a plan ignoring case, and planned amounts positive", async () => {
    const { h, planId } = await background();
    await addLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1_470_000 });
    const home = await postLine(h.ana, h.spaceId, planId, { name: "home", pesos: 1 });
    expect(await problemOf(home)).toEqual([409, "BudgetLineNameTaken"]);
    const gifts = await postLine(h.ana, h.spaceId, planId, { name: "Gifts", pesos: 0 });
    expect(await problemOf(gifts)).toEqual([422, "InvalidPlannedAmount"]);
    const negative = await postLine(h.ana, h.spaceId, planId, { name: "Gifts", pesos: -1 });
    expect(await problemOf(negative)).toEqual([422, "InvalidPlannedAmount"]);
    const blank = await postLine(h.ana, h.spaceId, planId, { name: "   ", pesos: 1 });
    expect(await problemOf(blank)).toEqual([422, "InvalidBudgetLineName"]);
    const long = await postLine(h.ana, h.spaceId, planId, { name: "x".repeat(61), pesos: 1 });
    expect(await problemOf(long)).toEqual([422, "InvalidBudgetLineName"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines.map((l) => l.name)).toEqual(["Home"]);
  });

  it("requires a SAVINGS account of a current member on a SAVINGS line (Review Focus 5)", async () => {
    const { h, planId } = await background();
    const savings = (savingsAccountIds?: string[]) =>
      postLine(h.ana, h.spaceId, planId, {
        name: "Savings",
        pesos: 600_000,
        funding: "SAVINGS",
        savingsAccountIds,
      });
    expect(await problemOf(await savings())).toEqual([422, "SavingsAccountRequired"]);
    expect(await problemOf(await savings([]))).toEqual([422, "SavingsAccountRequired"]);
    expect(await problemOf(await savings([h.juan.account]))).toEqual([422, "InvalidSavingsAccount"]);
    const marta = await registerUser("Marta");
    const martas = await newAccount(marta, "Ahorros", 0, "SAVINGS");
    expect(await problemOf(await savings([martas]))).toEqual([404, "AccountNotFound"]);
    expect(await problemOf(await savings(["not-a-uuid"]))).toEqual([404, "AccountNotFound"]);
    const juans = await newAccount(h.juan.personal, "Ahorros", 0, "SAVINGS");
    expect((await savings([juans])).status).toBe(201);
  });

  it("treats the savings account of a member who left the space as one that does not exist (P8)", async () => {
    const { h, planId } = await background();
    const juans = await newAccount(h.juan.personal, "Ahorros", 0, "SAVINGS");
    const savings = (id: string) =>
      postLine(h.ana, h.spaceId, id, {
        name: "Savings",
        pesos: 600_000,
        funding: "SAVINGS",
        savingsAccountIds: [juans],
      });
    expect((await savings(planId)).status).toBe(201);
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: h.juan,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    await setCapacities(h.ana, h.spaceId, december, [[h.ana.memberId, 1_600_000]]);
    expect(await problemOf(await savings(december))).toEqual([404, "AccountNotFound"]);
    expect((await planOf(h.ana, h.spaceId, december)).lines).toEqual([]);
  });

  it("answers the same for another user's account as for one that does not exist, and exposes only ids", async () => {
    const { h, planId } = await background();
    const savings = (savingsAccountIds: string[]) =>
      postLine(h.ana, h.spaceId, planId, {
        name: "Savings",
        pesos: 600_000,
        funding: "SAVINGS",
        savingsAccountIds,
      });
    const marta = await registerUser("Marta");
    const martas = await newAccount(marta, "Ahorros de Marta", 500_000, "SAVINGS");
    const foreign = await savings([martas]);
    const unknown = await savings(["0190a000-0000-7000-8000-000000000000"]);
    expect(await problemOf(foreign.clone())).toEqual([404, "AccountNotFound"]);
    expect(await disclosed(foreign)).toEqual(await disclosed(unknown));

    const anas = await newAccount(h.ana.personal, "Mis ahorros", 750_000, "SAVINGS");
    const response = await savings([anas]);
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(lineNamed(JSON.parse(text), "Savings").savingsAccountIds).toEqual([anas]);
    expect(text).not.toContain("Mis ahorros");
    expect(text).not.toContain("750000");
  });

  it("refuses an account twice, accounts on a line that is not SAVINGS, and an archived account", async () => {
    const { h, planId } = await background();
    const anas = await newAccount(h.ana.personal, "Ahorros", 0, "SAVINGS");
    const line = (name: string, extra: { funding?: string; savingsAccountIds?: string[] }) =>
      postLine(h.ana, h.spaceId, planId, { name, pesos: 100_000, ...extra });
    const twice = await line("Twice", { funding: "SAVINGS", savingsAccountIds: [anas, anas] });
    expect(await problemOf(twice)).toEqual([422, "InvalidSavingsAccount"]);
    const direct = await line("Direct", { funding: "DIRECT", savingsAccountIds: [anas] });
    expect(await problemOf(direct)).toEqual([422, "InvalidSavingsAccount"]);
    expect((await line("First", { funding: "SAVINGS", savingsAccountIds: [anas] })).status).toBe(201);
    const second = await line("Second", { funding: "SAVINGS", savingsAccountIds: [anas] });
    expect(await problemOf(second)).toEqual([409, "SavingsAccountAlreadyUsed"]);

    const old = await newAccount(h.ana.personal, "Viejo", 0, "SAVINGS");
    const archived = await call(
      archiveAccount,
      "POST",
      `/api/v1/spaces/${h.ana.personal.spaceId}/accounts/${old}/archive`,
      { user: h.ana.personal, params: { spaceId: h.ana.personal.spaceId, accountId: old } },
    );
    expect(archived.status).toBe(200);
    const onArchived = await line("Archived", { funding: "SAVINGS", savingsAccountIds: [old] });
    expect(await problemOf(onArchived)).toEqual([409, "AccountArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines.map((l) => l.name)).toEqual(["First"]);
  });

  it("accepts one catch-all line, refuses a second, and refuses a SAVINGS line as catch-all", async () => {
    const { h, planId } = await background();
    const anas = await newAccount(h.ana.personal, "Ahorros", 0, "SAVINGS");
    const first = await addLine(h.ana, h.spaceId, planId, {
      name: "Everything else",
      pesos: 100_000,
      isCatchAll: true,
    });
    expect(lineNamed(first, "Everything else").isCatchAll).toBe(true);
    const second = await postLine(h.ana, h.spaceId, planId, {
      name: "Also",
      pesos: 100_000,
      isCatchAll: true,
    });
    expect(await problemOf(second)).toEqual([409, "CatchAllLineAlreadySet"]);
    const savings = await postLine(h.ana, h.spaceId, planId, {
      name: "Savings",
      pesos: 100_000,
      funding: "SAVINGS",
      savingsAccountIds: [anas],
      isCatchAll: true,
    });
    expect(await problemOf(savings)).toEqual([409, "SavingsLineNotMappable"]);
  });

  it("reports negative unallocated capacity once Juan's capacity drops to 2,000,000 COP (HU-E6-02, Review Focus 3)", async () => {
    const { h, planId } = await referencePlan();
    const plan = await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect([plan.totalCapacity, plan.unallocated]).toEqual([cop(3_600_000), cop(-400_000)]);
    const more = await postLine(h.ana, h.spaceId, planId, { name: "Travel", pesos: 1 });
    expect(await problemOf(more)).toEqual([409, "PlanExceedsCapacity"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines).toHaveLength(4);
  });

  it("refuses MEMBER Juan and a stale If-Match", async () => {
    const { h, planId } = await background();
    const juans = await postLine(h.juan, h.spaceId, planId, { name: "Home", pesos: 1 });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await postLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1 }, 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines).toEqual([]);
  });

  it("lets an ADMIN add, refuses a VIEWER, and answers 404 to a stranger, a foreign plan and a malformed id", async () => {
    const { h, planId } = await background();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    expect((await postLine(luis, h.spaceId, planId, { name: "Home", pesos: 1_470_000 })).status).toBe(201);
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    expect(await problemOf(await postLine(vera, h.spaceId, planId, { name: "Gifts", pesos: 1 }))).toEqual([
      403,
      "InsufficientRole",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await postLine(marta, h.spaceId, planId, { name: "Gifts", pesos: 1 }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    expect(
      await problemOf(await postLine(h.ana, h.spaceId, foreign.id, { name: "Gifts", pesos: 1 })),
    ).toEqual([404, "BudgetPlanNotFound"]);
    expect(
      await problemOf(await postLine(h.ana, h.spaceId, "not-a-uuid", { name: "Gifts", pesos: 1 })),
    ).toEqual([404, "BudgetPlanNotFound"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines.map((l) => l.name)).toEqual(["Home"]);
  });

  it("refuses a line in an archived space (HU-E1-09)", async () => {
    const { h, planId } = await background();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const refused = await postLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1_470_000 });
    expect(await problemOf(refused)).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines).toEqual([]);
  });

  it("validates the body: unknown values, more than 20 accounts, other currencies", async () => {
    const { h, planId } = await background();
    const valid = { name: "Home", plannedAmount: cop(1) };
    const refusal = async (body: unknown) => problemOf(await postRaw(h, planId, body));
    expect(await refusal({ ...valid, funding: "CASH" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ ...valid, rolloverMode: "FOREVER" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ ...valid, isCatchAll: "yes" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ name: "Home" })).toEqual([422, "ValidationFailed"]);
    const accounts = Array.from({ length: 21 }, (_, i) => `account-${i}`);
    expect(await refusal({ ...valid, funding: "SAVINGS", savingsAccountIds: accounts })).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await refusal({ ...valid, plannedAmount: { amount: "100", currency: "USD" } })).toEqual([
      422,
      "CurrencyMismatch",
    ]);
    expect(await refusal({ ...valid, plannedAmount: { amount: "100", currency: "ZZZ" } })).toEqual([
      422,
      "UnknownCurrency",
    ]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines).toEqual([]);
  });

  it("ignores fields it does not know, like every body in the API, and never takes an id from the client", async () => {
    const { h, planId } = await background();
    const response = await postRaw(h, planId, {
      name: "Home",
      plannedAmount: cop(1_470_000),
      id: "0190a000-0000-7000-8000-000000000000",
      allocationRule: "FIXED",
      deletedAt: "2026-11-01T00:00:00.000Z",
      spent: cop(5),
      colour: "red",
    });
    expect(response.status).toBe(201);
    const home = lineNamed(await response.json(), "Home");
    expect(home.id).not.toBe("0190a000-0000-7000-8000-000000000000");
    expect(home).toMatchObject({ spent: cop(0), allocation: { rule: "PROPORTIONAL" } });
    expect(home).not.toHaveProperty("colour");
  });
});
