import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  activatePlan,
  addLine,
  closePlan,
  copyPlan,
  getPlan,
  lineNamed,
  newPlan,
  patchLine,
  planOf,
  plansPath,
  putAllocation,
  putCategories,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { categoryWithKey, household, joinHousehold, newAccount } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Copies into `period` and returns the copy; fails the test unless 201. */
const copied = async (user: TestUser, spaceId: string, period: string): Promise<PlanDto> => {
  const response = await copyPlan(user, spaceId, period);
  expect(response.status).toBe(201);
  return (await response.json()) as PlanDto;
};

/** `member` leaves the household. */
const leaves = async (member: TestUser, spaceId: string) => {
  const left = await call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, {
    user: member,
    params: { spaceId },
  });
  expect(left.status).toBe(204);
};

/**
 * HU-E6-06 Background: the reference plan for 2026-11 with Groceries and Utilities mapped to Home, Free the
 * catch-all line allocated 42 % / 58 %.
 */
const november = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const utilities = await categoryWithKey(h.ana, "utilities");
  expect(
    (await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries, utilities])).status,
  ).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Free"), { isCatchAll: true })).status).toBe(200);
  const split = {
    rule: "PERCENT",
    members: [
      { memberId: h.ana.memberId, percent: "42" },
      { memberId: h.juan.memberId, percent: "58" },
    ],
  };
  expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), split)).status).toBe(200);
  return { ...ref, utilities };
};

describe("copying a plan from the previous period (HU-E6-06)", () => {
  it("creates the 2026-12 plan as a DRAFT copy of 2026-11 (@critical)", async () => {
    const { h, planId, lineId, savings, utilities } = await november();
    const response = await copyPlan(h.ana, h.spaceId, "2026-12");
    expect([response.status, response.headers.get("etag")]).toEqual([201, '"1"']);
    const copy = (await response.json()) as PlanDto;
    expect(response.headers.get("location")).toBe(`/api/v1/spaces/${h.spaceId}/plans/${copy.id}`);
    expect(copy).toMatchObject({
      status: "DRAFT",
      createdFrom: planId,
      period: { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" },
      capacities: [
        { memberId: h.ana.memberId, amount: { amount: "160000000", currency: "COP" }, share: "40.00" },
        { memberId: h.juan.memberId, amount: { amount: "240000000", currency: "COP" }, share: "60.00" },
      ],
      dropped: { mappings: [], savingsAccounts: [], lines: [] },
    });
    expect(
      copy.lines.map((l) => [l.name, l.plannedAmount.amount, l.funding, l.rolloverMode, l.originLineId]),
    ).toEqual([
      ["Rent", "120000000", "SHARED_FUND", "RESET", lineId("Rent")],
      ["Home", "147000000", "DIRECT", "RESET", lineId("Home")],
      ["Savings", "60000000", "SAVINGS", "RESET", lineId("Savings")],
      ["Free", "73000000", "DIRECT", "RESET", lineId("Free")],
    ]);
    expect([...lineNamed(copy, "Home").categoryIds].sort()).toEqual([h.groceries, utilities].sort());
    expect(lineNamed(copy, "Savings").savingsAccountIds).toEqual([savings]);
    expect(lineNamed(copy, "Free")).toMatchObject({
      isCatchAll: true,
      allocation: {
        rule: "PERCENT",
        members: [
          { memberId: h.ana.memberId, percent: "42.00" },
          { memberId: h.juan.memberId, percent: "58.00" },
        ],
        error: null,
      },
    });
    const read = await planOf(h.juan, h.spaceId, copy.id);
    expect(read).not.toHaveProperty("dropped");
    expect(read.lines.map((l) => l.id)).toEqual(copy.lines.map((l) => l.id));
  });

  it("copies December from a CLOSED November and leaves the closed source exactly as it was", async () => {
    const { h, planId, lineId } = await november();
    expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    expect((await closePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    const before = await getPlan(h.ana, h.spaceId, planId);
    const [etag, source] = [before.headers.get("etag"), (await before.json()) as PlanDto];
    expect(source.status).toBe("CLOSED");
    const copy = await copied(h.ana, h.spaceId, "2026-12");
    expect(copy).toMatchObject({ status: "DRAFT", createdFrom: planId, dropped: { lines: [] } });
    expect(copy.lines.map((l) => l.originLineId)).toEqual(
      ["Rent", "Home", "Savings", "Free"].map((name) => lineId(name)),
    );
    const after = await getPlan(h.ana, h.spaceId, planId);
    expect(after.headers.get("etag")).toBe(etag);
    expect(await after.json()).toEqual(source);
  });

  it("answers NoPreviousPlan when Household has no plan for 2026-11, even with one for 2026-10", async () => {
    const h = await household();
    const october = await newPlan(h.ana, h.spaceId, "2026-10");
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-12"))).toEqual([409, "NoPreviousPlan"]);
    expect((await copied(h.ana, h.spaceId, "2026-11")).createdFrom).toBe(october.id);
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-11"))).toEqual([409, "PlanAlreadyExists"]);
  });

  it("refuses any copyFrom but previous as ValidationFailed and creates no plan", async () => {
    const { h } = await referencePlan();
    for (const copyFrom of ["template", 42, ["previous"]]) {
      const response = await call(createPlanRoute, "POST", plansPath(h.spaceId), {
        user: h.ana,
        params: { spaceId: h.spaceId },
        body: { period: "2026-12", copyFrom },
      });
      expect(await problemOf(response)).toEqual([422, "ValidationFailed"]);
    }
    // Had any of them created the 2026-12 plan, this copy would answer PlanAlreadyExists.
    expect((await copied(h.ana, h.spaceId, "2026-12")).status).toBe("DRAFT");
  });

  it("drops the mapping of Utilities, archived after the 2026-11 plan was made, and lists it", async () => {
    const { h, utilities } = await november();
    const archived = await call(
      archiveCategory,
      "POST",
      `/api/v1/spaces/${h.spaceId}/categories/${utilities}/archive`,
      {
        user: h.ana,
        params: { spaceId: h.spaceId, categoryId: utilities },
      },
    );
    expect(archived.status).toBe(200);
    const copy = await copied(h.ana, h.spaceId, "2026-12");
    const home = lineNamed(copy, "Home");
    expect(home.categoryIds).toEqual([h.groceries]);
    expect(copy.dropped?.mappings).toEqual([{ lineId: home.id, categoryId: utilities }]);
  });

  it("flags Free with InvalidAllocation when Luis, allocated 10 % of it in 2026-11, has left (Review Focus 3)", async () => {
    const { h, planId, lineId } = await november();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const split = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "48" },
        { memberId: luis.memberId, percent: "10" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), split)).status).toBe(200);
    await leaves(luis, h.spaceId);
    const free = lineNamed(await copied(h.ana, h.spaceId, "2026-12"), "Free");
    expect(free.allocation).toMatchObject({
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42.00", assigned: null },
        { memberId: h.juan.memberId, percent: "48.00", assigned: null },
      ],
      error: "InvalidAllocation",
    });
  });

  it("leaves out the savings line of Luis, who left, and keeps Ana's (P10, Review Focus 3)", async () => {
    const { h, planId, savings } = await november();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const luisSavings = await newAccount(luis.personal, "Ahorros Luis", 0, "SAVINGS");
    await setCapacities(h.ana, h.spaceId, planId, [[luis.memberId, 100_000]]);
    const withTrip = await addLine(luis, h.spaceId, planId, {
      name: "Trip",
      pesos: 100_000,
      funding: "SAVINGS",
      savingsAccountIds: [luisSavings],
    });
    await leaves(luis, h.spaceId);
    const copy = await copied(h.ana, h.spaceId, "2026-12");
    expect(copy.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings", "Free"]);
    expect(lineNamed(copy, "Savings").savingsAccountIds).toEqual([savings]);
    expect(copy.dropped).toEqual({
      mappings: [],
      savingsAccounts: [],
      lines: [{ originLineId: lineNamed(withTrip, "Trip").id, name: "Trip" }],
    });
  });

  it("lets only owners and admins copy, and refuses non-members and archived spaces (Review Focus 5)", async () => {
    const { h } = await referencePlan();
    const marta = await registerUser("Marta");
    expect(await problemOf(await copyPlan(h.juan, h.spaceId, "2026-12"))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await copyPlan(marta, h.spaceId, "2026-12"))).toEqual([404, "SpaceNotFound"]);
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await problemOf(await copyPlan(h.ana, h.spaceId, "2026-12"))).toEqual([409, "SpaceArchived"]);
  });
});
