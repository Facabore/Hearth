import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as patchLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  addLine,
  deleteLine,
  lineNamed,
  newPlan,
  patchLine,
  planOf,
  plansPath,
  postLine,
  referencePlan,
  setCapacities,
  type LineSpec,
  type PlanDto,
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

/** A PATCH with an arbitrary body, for requests the typed helper cannot build. */
const patchRaw = (h: Awaited<ReturnType<typeof household>>, planId: string, lineId: string, body: unknown) =>
  call(patchLineRoute, "PATCH", plansPath(h.spaceId, `/${planId}/lines/${lineId}`), {
    user: h.ana,
    params: { spaceId: h.spaceId, planId, lineId },
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

describe("editing lines (HU-E6-03, HU-E6-04)", () => {
  it("marks Free as the plan's catch-all line, and refuses a second one", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true });
    expect(free.status).toBe(200);
    const plan = (await free.json()) as PlanDto;
    expect([lineNamed(plan, "Free").isCatchAll, plan.unbudgeted]).toEqual([true, null]);
    const home = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { isCatchAll: true });
    expect(await problemOf(home)).toEqual([409, "CatchAllLineAlreadySet"]);
  });

  it("moves the catch-all line: unmarking Free brings Unbudgeted back, and then Home takes it", async () => {
    const { h, planId, lineId } = await referencePlan();
    const mark = (name: string, isCatchAll: boolean) =>
      patchLine(h.ana, h.spaceId, planId, lineId(name), { isCatchAll });
    expect((await mark("Free", true)).status).toBe(200);
    expect((await mark("Free", true)).status).toBe(200);
    const unmarked = (await (await mark("Free", false)).json()) as PlanDto;
    expect([unmarked.lines.some((l) => l.isCatchAll), unmarked.unbudgeted === null]).toEqual([false, false]);
    const moved = (await (await mark("Home", true)).json()) as PlanDto;
    expect([moved.lines.filter((l) => l.isCatchAll).map((l) => l.name), moved.unbudgeted]).toEqual([
      ["Home"],
      null,
    ]);
  });

  it("refuses an increase past the capacity, and renames and lowers a line", async () => {
    const { h, planId, lineId } = await referencePlan();
    const edit = (changes: Partial<LineSpec>) => patchLine(h.ana, h.spaceId, planId, lineId("Home"), changes);
    expect(await problemOf(await edit({ pesos: 1_470_001 }))).toEqual([409, "PlanExceedsCapacity"]);
    const raise = await edit({ pesos: 1_500_000 });
    expect(await problemOf(raise)).toEqual([409, "PlanExceedsCapacity"]);
    const changed = await edit({ pesos: 1_400_000, name: "House" });
    const plan = (await changed.json()) as PlanDto;
    expect([lineNamed(plan, "House").plannedAmount, plan.unallocated]).toEqual([cop(1_400_000), cop(70_000)]);
    const back = (await (await edit({ pesos: 1_470_000 })).json()) as PlanDto;
    expect(back.unallocated).toEqual(cop(0));
  });

  it("lets a line be renamed, re-saved and lowered once the capacity fell below the plan, but not raised", async () => {
    const { h, planId, lineId } = await referencePlan();
    const over = await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect(over.unallocated).toEqual(cop(-400_000));
    const edit = (name: string, changes: Partial<LineSpec>) =>
      patchLine(h.ana, h.spaceId, planId, lineId(name), changes);
    const renamed = await edit("Rent", { name: "Housing fund" });
    expect([
      renamed.status,
      lineNamed((await renamed.json()) as PlanDto, "Housing fund").plannedAmount,
    ]).toEqual([200, cop(1_200_000)]);
    expect((await edit("Home", { pesos: 1_470_000 })).status).toBe(200);
    const lowered = (await (await edit("Free", { pesos: 700_000 })).json()) as PlanDto;
    expect(lowered.unallocated).toEqual(cop(-370_000));
    expect(await problemOf(await edit("Free", { pesos: 700_001 }))).toEqual([409, "PlanExceedsCapacity"]);
  });

  it("keeps line names unique ignoring case and planned amounts positive when a line is edited", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const edit = (changes: Partial<LineSpec>) => patchLine(h.ana, h.spaceId, planId, lineId("Home"), changes);
    expect(await problemOf(await edit({ name: "rent" }))).toEqual([409, "BudgetLineNameTaken"]);
    expect(await problemOf(await edit({ pesos: 0 }))).toEqual([422, "InvalidPlannedAmount"]);
    expect(await problemOf(await edit({ pesos: -1 }))).toEqual([422, "InvalidPlannedAmount"]);
    expect(await problemOf(await edit({ name: "   " }))).toEqual([422, "InvalidBudgetLineName"]);
    expect(await problemOf(await edit({ name: "x".repeat(61) }))).toEqual([422, "InvalidBudgetLineName"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    const sameName = (await (await edit({ name: "HOME" })).json()) as PlanDto;
    expect(sameName.lines.map((l) => l.name)).toEqual(["Rent", "HOME", "Savings", "Free"]);
    const trimmed = (await (await edit({ name: "  House  " })).json()) as PlanDto;
    expect(trimmed.lines.map((l) => l.name)).toEqual(["Rent", "House", "Savings", "Free"]);
  });

  it("changes only the fields it names, and answers the whole plan with its new ETag", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const response = await patchLine(
      h.ana,
      h.spaceId,
      planId,
      lineId("Home"),
      { funding: "SHARED_FUND", rolloverMode: "ROLLOVER" },
      plan.version,
    );
    expect([response.status, response.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    const changed = (await response.json()) as PlanDto;
    expect(changed.version).toBe(plan.version + 1);
    expect(changed.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings", "Free"]);
    expect(lineNamed(changed, "Home")).toEqual({
      ...lineNamed(plan, "Home"),
      funding: "SHARED_FUND",
      rolloverMode: "ROLLOVER",
    });
    expect(changed.lines.filter((l) => l.name !== "Home")).toEqual(
      plan.lines.filter((l) => l.name !== "Home"),
    );
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(changed);
  });

  it("applies the SAVINGS rules when a line is edited: accounts required, kept, replaced and dropped", async () => {
    const { h, savings, planId, lineId } = await referencePlan();
    const edit = (name: string, changes: Partial<LineSpec>) =>
      patchLine(h.ana, h.spaceId, planId, lineId(name), changes);
    const refusal = async (name: string, changes: Partial<LineSpec>) => problemOf(await edit(name, changes));
    const juans = await newAccount(h.juan.personal, "Ahorros", 0, "SAVINGS");

    expect(await refusal("Home", { funding: "SAVINGS" })).toEqual([422, "SavingsAccountRequired"]);
    expect(await refusal("Savings", { savingsAccountIds: [] })).toEqual([422, "SavingsAccountRequired"]);
    expect(await refusal("Free", { savingsAccountIds: [juans] })).toEqual([422, "InvalidSavingsAccount"]);
    expect(await refusal("Savings", { savingsAccountIds: [savings, savings] })).toEqual([
      422,
      "InvalidSavingsAccount",
    ]);
    expect(await refusal("Savings", { savingsAccountIds: [h.juan.account] })).toEqual([
      422,
      "InvalidSavingsAccount",
    ]);
    expect(await refusal("Home", { funding: "SAVINGS", savingsAccountIds: [savings] })).toEqual([
      409,
      "SavingsAccountAlreadyUsed",
    ]);
    expect(await refusal("Savings", { isCatchAll: true })).toEqual([409, "SavingsLineNotMappable"]);

    const renamed = (await (await edit("Savings", { name: "Nest egg" })).json()) as PlanDto;
    expect(lineNamed(renamed, "Nest egg").savingsAccountIds).toEqual([savings]);
    const swapped = (await (await edit("Savings", { savingsAccountIds: [juans] })).json()) as PlanDto;
    expect(lineNamed(swapped, "Nest egg").savingsAccountIds).toEqual([juans]);
    const home = await edit("Home", { funding: "SAVINGS", savingsAccountIds: [savings] });
    expect(lineNamed((await home.json()) as PlanDto, "Home")).toMatchObject({
      funding: "SAVINGS",
      savingsAccountIds: [savings],
    });
    const dropped = (await (await edit("Savings", { funding: "DIRECT" })).json()) as PlanDto;
    expect(lineNamed(dropped, "Nest egg")).toMatchObject({ funding: "DIRECT", savingsAccountIds: [] });
  });

  it("answers the same for another user's account as for one that does not exist, and refuses an archived one", async () => {
    const { h, planId, lineId } = await referencePlan();
    const edit = (changes: Partial<LineSpec>) =>
      patchLine(h.ana, h.spaceId, planId, lineId("Savings"), changes);
    const marta = await registerUser("Marta");
    const martas = await newAccount(marta, "Ahorros de Marta", 500_000, "SAVINGS");
    const foreign = await edit({ savingsAccountIds: [martas] });
    const unknown = await edit({ savingsAccountIds: ["0190a000-0000-7000-8000-000000000000"] });
    expect(await problemOf(foreign.clone())).toEqual([404, "AccountNotFound"]);
    expect(await disclosed(foreign)).toEqual(await disclosed(unknown));
    expect(await problemOf(await edit({ savingsAccountIds: ["not-a-uuid"] }))).toEqual([
      404,
      "AccountNotFound",
    ]);

    const old = await newAccount(h.ana.personal, "Viejo", 0, "SAVINGS");
    const archived = await call(
      archiveAccount,
      "POST",
      `/api/v1/spaces/${h.ana.personal.spaceId}/accounts/${old}/archive`,
      { user: h.ana.personal, params: { spaceId: h.ana.personal.spaceId, accountId: old } },
    );
    expect(archived.status).toBe(200);
    expect(await problemOf(await edit({ savingsAccountIds: [old] }))).toEqual([409, "AccountArchived"]);
  });

  it("refuses to turn a line with mapped categories into a SAVINGS line, and unmaps nothing (spec 5.4)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const juans = await newAccount(h.juan.personal, "Ahorros", 0, "SAVINGS");
    const home = lineId("Home");
    // Category mapping has no endpoint yet (Task 15): the mapping is arranged directly in the table.
    await app.pool.query(
      "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at) VALUES ($1, $2, $3, now())",
      [planId, home, h.groceries],
    );
    const toSavings = await patchLine(h.ana, h.spaceId, planId, home, {
      funding: "SAVINGS",
      savingsAccountIds: [juans],
    });
    expect(await problemOf(toSavings)).toEqual([409, "SavingsLineNotMappable"]);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home")).toMatchObject({
      funding: "DIRECT",
      savingsAccountIds: [],
      categoryIds: [h.groceries],
    });
    const { rows } = await app.pool.query(
      "SELECT unmapped_at FROM budget_line_categories WHERE line_id = $1",
      [home],
    );
    expect(rows.map((r) => r.unmapped_at)).toEqual([null]);
  });

  it("refuses MEMBER Juan and a stale If-Match, and keeps the plan as it was", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const juans = await patchLine(h.juan, h.spaceId, planId, lineId("Home"), { name: "X" });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { name: "X" }, plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    const current = await patchLine(
      h.ana,
      h.spaceId,
      planId,
      lineId("Home"),
      { name: "House" },
      plan.version,
    );
    expect(current.status).toBe(200);
  });

  it("lets an ADMIN edit, refuses a VIEWER, and answers 404 to a stranger, a foreign plan and a foreign or malformed line", async () => {
    const { h, planId, lineId } = await referencePlan();
    const home = lineId("Home");
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    expect((await patchLine(luis, h.spaceId, planId, home, { name: "House" })).status).toBe(200);
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    expect(await problemOf(await patchLine(vera, h.spaceId, planId, home, { name: "Den" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await patchLine(marta, h.spaceId, planId, home, { name: "Den" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    expect(await problemOf(await patchLine(h.ana, h.spaceId, foreign.id, home, { name: "Den" }))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await patchLine(h.ana, h.spaceId, "not-a-uuid", home, { name: "Den" }))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);

    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    await setCapacities(h.ana, h.spaceId, december, [[h.ana.memberId, 1_600_000]]);
    const later = lineNamed(
      await addLine(h.ana, h.spaceId, december, { name: "Food", pesos: 500_000 }),
      "Food",
    );
    const other = await referencePlan();
    for (const lineOfElsewhere of [
      later.id,
      other.lineId("Home"),
      "0190a000-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      const response = await patchLine(h.ana, h.spaceId, planId, lineOfElsewhere, { name: "Den" });
      expect(await problemOf(response)).toEqual([404, "BudgetLineNotFound"]);
    }
    expect((await planOf(h.ana, h.spaceId, planId)).lines.map((l) => l.name)).toEqual([
      "Rent",
      "House",
      "Savings",
      "Free",
    ]);
    expect((await planOf(h.ana, h.spaceId, december)).lines.map((l) => l.name)).toEqual(["Food"]);
  });

  it("refuses an edit in an archived space (HU-E1-09)", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const refused = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { name: "House" });
    expect(await problemOf(refused)).toEqual([409, "SpaceArchived"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("validates the body: at least one field, known values, at most 20 accounts, other currencies", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const refusal = async (body: unknown) => problemOf(await patchRaw(h, planId, lineId("Home"), body));
    expect(await refusal({})).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ colour: "red" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal([])).toEqual([422, "ValidationFailed"]);
    expect(await refusal(null)).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ funding: "CASH" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ rolloverMode: "FOREVER" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ isCatchAll: "yes" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ name: 5 })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ plannedAmount: "100" })).toEqual([422, "ValidationFailed"]);
    expect(await refusal({ plannedAmount: { amount: "12.5", currency: "COP" } })).toEqual([
      422,
      "ValidationFailed",
    ]);
    const accounts = Array.from({ length: 21 }, (_, i) => `account-${i}`);
    expect(await refusal({ funding: "SAVINGS", savingsAccountIds: accounts })).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await refusal({ plannedAmount: { amount: "100", currency: "USD" } })).toEqual([
      422,
      "CurrencyMismatch",
    ]);
    expect(await refusal({ plannedAmount: { amount: "100", currency: "ZZZ" } })).toEqual([
      422,
      "UnknownCurrency",
    ]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("explains an empty body in the problem's field errors", async () => {
    const { h, planId, lineId } = await referencePlan();
    const problem = await (await patchRaw(h, planId, lineId("Home"), {})).json();
    expect(problem.errors).toEqual([{ path: "", message: expect.stringContaining("at least one field") }]);
  });

  it("ignores fields it does not know, and never lets the client choose the id or the allocation", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const response = await patchRaw(h, planId, lineId("Home"), {
      name: "House",
      id: "0190a000-0000-7000-8000-000000000000",
      planId: "0190a000-0000-7000-8000-000000000001",
      allocationRule: "FIXED",
      deletedAt: "2026-11-01T00:00:00.000Z",
      spent: cop(5),
      colour: "red",
    });
    expect(response.status).toBe(200);
    const changed = (await response.json()) as PlanDto;
    const house = lineNamed(changed, "House");
    expect(house).toEqual({ ...lineNamed(plan, "Home"), name: "House" });
    expect(house).not.toHaveProperty("colour");
    expect(changed.lines).toHaveLength(4);
  });
});

describe("removing lines (HU-E6-03, D8)", () => {
  /** The stored rows of the plan's lines named `name`, oldest first: removed rows stay (D8). */
  const rowsNamed = async (planId: string, name: string) => {
    const { rows } = await app.pool.query(
      "SELECT id, is_catch_all, deleted_at FROM budget_lines WHERE plan_id = $1 AND name = $2 ORDER BY created_at, id",
      [planId, name],
    );
    return rows as { id: string; is_catch_all: boolean; deleted_at: Date | null }[];
  };
  /** Category mapping has no endpoint yet (Task 15): a mapping is arranged directly in the table. */
  const mapCategory = (planId: string, lineId: string, categoryId: string) =>
    app.pool.query(
      "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at) VALUES ($1, $2, $3, now())",
      [planId, lineId, categoryId],
    );

  it("removes a line logically: the plan drops it, its name is free again and its row stays (D8, Review Focus 6)", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const home = lineId("Home");
    const removed = await deleteLine(h.ana, h.spaceId, planId, home);
    expect([removed.status, removed.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    const after = (await removed.json()) as PlanDto;
    expect([after.version, after.lines.map((l) => l.name), after.planned, after.unallocated]).toEqual([
      plan.version + 1,
      ["Rent", "Savings", "Free"],
      cop(2_530_000),
      cop(1_470_000),
    ]);
    expect(after.lines.map((l) => l.capacityShare)).toEqual(["30.00", "15.00", "18.25"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(after);

    const again = await addLine(h.ana, h.spaceId, planId, { name: "Home", pesos: 1_470_000 });
    const rows = await rowsNamed(planId, "Home");
    expect(rows.map((r) => [r.id, r.deleted_at !== null])).toEqual([
      [home, true],
      [lineNamed(again, "Home").id, false],
    ]);
  });

  it("answers 404 to a second removal and to an edit of a removed line, and keeps its row removed", async () => {
    const { h, planId, lineId } = await referencePlan();
    const home = lineId("Home");
    expect((await deleteLine(h.ana, h.spaceId, planId, home)).status).toBe(200);
    expect(await problemOf(await deleteLine(h.ana, h.spaceId, planId, home))).toEqual([
      404,
      "BudgetLineNotFound",
    ]);
    const edit = await patchLine(h.ana, h.spaceId, planId, home, { name: "House" });
    expect(await problemOf(edit)).toEqual([404, "BudgetLineNotFound"]);
    expect((await rowsNamed(planId, "Home")).map((r) => r.deleted_at !== null)).toEqual([true]);
    expect((await planOf(h.ana, h.spaceId, planId)).lines.map((l) => l.name)).toEqual([
      "Rent",
      "Savings",
      "Free",
    ]);
  });

  it("frees the catch-all slot: Unbudgeted is back, another line can take it, and the removed row keeps its flag", async () => {
    const { h, planId, lineId } = await referencePlan();
    expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(
      200,
    );
    const removed = (await (await deleteLine(h.ana, h.spaceId, planId, lineId("Free"))).json()) as PlanDto;
    expect([removed.lines.some((l) => l.isCatchAll), removed.unbudgeted === null]).toEqual([false, false]);
    const marked = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { isCatchAll: true });
    expect(marked.status).toBe(200);
    expect(lineNamed((await marked.json()) as PlanDto, "Home").isCatchAll).toBe(true);
    const free = await rowsNamed(planId, "Free");
    expect(free.map((r) => [r.is_catch_all, r.deleted_at !== null])).toEqual([[true, true]]);
  });

  it("ends the line's mappings and frees its categories for another line", async () => {
    const { h, planId, lineId } = await referencePlan();
    const home = lineId("Home");
    await mapCategory(planId, home, h.groceries);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").categoryIds).toEqual([h.groceries]);
    expect((await deleteLine(h.ana, h.spaceId, planId, home)).status).toBe(200);
    const { rows } = await app.pool.query(
      "SELECT unmapped_at FROM budget_line_categories WHERE line_id = $1",
      [home],
    );
    expect(rows.map((r) => r.unmapped_at !== null)).toEqual([true]);
    await mapCategory(planId, lineId("Rent"), h.groceries);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Rent").categoryIds).toEqual([h.groceries]);
  });

  it("frees the savings account of a removed SAVINGS line for another line", async () => {
    const { h, savings, planId, lineId } = await referencePlan();
    const taken = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), {
      funding: "SAVINGS",
      savingsAccountIds: [savings],
    });
    expect(await problemOf(taken)).toEqual([409, "SavingsAccountAlreadyUsed"]);
    expect((await deleteLine(h.ana, h.spaceId, planId, lineId("Savings"))).status).toBe(200);
    const moved = await patchLine(h.ana, h.spaceId, planId, lineId("Home"), {
      funding: "SAVINGS",
      savingsAccountIds: [savings],
    });
    expect(lineNamed((await moved.json()) as PlanDto, "Home")).toMatchObject({
      funding: "SAVINGS",
      savingsAccountIds: [savings],
    });
  });

  it("never needs a capacity check: a plan over its capacity loses a line and regains room", async () => {
    const { h, planId, lineId } = await referencePlan();
    const over = await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect(over.unallocated).toEqual(cop(-400_000));
    const removed = (await (await deleteLine(h.ana, h.spaceId, planId, lineId("Free"))).json()) as PlanDto;
    expect([removed.planned, removed.unallocated]).toEqual([cop(3_270_000), cop(330_000)]);
  });

  it("refuses MEMBER Juan and a stale If-Match, and keeps the plan as it was", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const juans = await deleteLine(h.juan, h.spaceId, planId, lineId("Home"));
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await deleteLine(h.ana, h.spaceId, planId, lineId("Home"), plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    expect((await deleteLine(h.ana, h.spaceId, planId, lineId("Home"), plan.version)).status).toBe(200);
  });

  it("lets an ADMIN remove, refuses a VIEWER, and answers 404 to a stranger, a foreign plan and a foreign or malformed line", async () => {
    const { h, planId, lineId } = await referencePlan();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    const marta = await registerUser("Marta");
    const home = lineId("Home");
    expect(await problemOf(await deleteLine(vera, h.spaceId, planId, home))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await problemOf(await deleteLine(marta, h.spaceId, planId, home))).toEqual([404, "SpaceNotFound"]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    expect(await problemOf(await deleteLine(h.ana, h.spaceId, foreign.id, home))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await deleteLine(h.ana, h.spaceId, "not-a-uuid", home))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);

    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    await setCapacities(h.ana, h.spaceId, december, [[h.ana.memberId, 1_600_000]]);
    const later = lineNamed(
      await addLine(h.ana, h.spaceId, december, { name: "Food", pesos: 500_000 }),
      "Food",
    );
    const other = await referencePlan();
    for (const lineOfElsewhere of [
      later.id,
      other.lineId("Home"),
      "0190a000-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      const response = await deleteLine(h.ana, h.spaceId, planId, lineOfElsewhere);
      expect(await problemOf(response)).toEqual([404, "BudgetLineNotFound"]);
    }
    expect((await planOf(h.ana, h.spaceId, planId)).lines).toHaveLength(4);
    expect((await planOf(h.ana, h.spaceId, december)).lines.map((l) => l.name)).toEqual(["Food"]);
    expect((await planOf(other.h.ana, other.h.spaceId, other.planId)).lines).toHaveLength(4);

    const removed = (await (await deleteLine(luis, h.spaceId, planId, home)).json()) as PlanDto;
    expect(removed.lines.map((l) => l.name)).toEqual(["Rent", "Savings", "Free"]);
  });

  it("refuses a removal in an archived space (HU-E1-09), and the line stays", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const refused = await deleteLine(h.ana, h.spaceId, planId, lineId("Home"));
    expect(await problemOf(refused)).toEqual([409, "SpaceArchived"]);
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
    expect((await rowsNamed(planId, "Home")).map((r) => r.deleted_at)).toEqual([null]);
  });
});
