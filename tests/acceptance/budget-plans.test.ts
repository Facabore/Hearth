import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { createPlan, getPlan, newPlan, planOf, plansPath } from "../support/budgeting";
import { categoryWithKey, cop, household, inSpace, newAccount, post } from "../support/ledger";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const patchSpace = (user: TestUser, spaceId: string, body: unknown) =>
  call(updateSpace, "PATCH", `/api/v1/spaces/${spaceId}`, { user, params: { spaceId }, body });
const periods = async (user: TestUser, spaceId: string, query: string) => {
  const response = await call(listPeriods, "GET", `/api/v1/spaces/${spaceId}/periods${query}`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: unknown[] }).items;
};

describe("create a plan for a period (HU-E6-01)", () => {
  it("creates a DRAFT plan for 2026-11 from 2026-11-01 to 2026-11-30 with its ETag and location", async () => {
    const h = await household();
    const created = await createPlan(h.ana, h.spaceId, "2026-11");
    expect(created.status).toBe(201);
    expect(created.headers.get("etag")).toBe('"1"');
    const plan = await created.json();
    expect(created.headers.get("location")).toBe(plansPath(h.spaceId, `/${plan.id}`));
    expect(plan).toEqual({
      id: plan.id,
      spaceId: h.spaceId,
      period: { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      capacities: [
        { memberId: h.ana.memberId, amount: cop(0), share: null },
        { memberId: h.juan.memberId, amount: cop(0), share: null },
      ],
      totalCapacity: cop(0),
      planned: cop(0),
      unallocated: cop(0),
      lines: [],
      unbudgeted: { spent: cop(0), available: cop(0) },
    });
  });

  it("allows only one plan per period", async () => {
    const h = await household();
    await newPlan(h.ana, h.spaceId, "2026-11");
    expect(await problemOf(await createPlan(h.ana, h.spaceId, "2026-11"))).toEqual([
      409,
      "PlanAlreadyExists",
    ]);
  });

  it("lets only owners and admins create plans, and refused attempts store nothing (Review Focus 5)", async () => {
    const h = await household();
    const admin = await registerUser("Alba");
    const viewer = await registerUser("Vera");
    const marta = await registerUser("Marta");
    await joinAs(h.ana, h.spaceId, admin, "ADMIN");
    await joinAs(h.ana, h.spaceId, viewer, "VIEWER");
    expect(await problemOf(await createPlan(h.juan, h.spaceId, "2026-12"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await problemOf(await createPlan(viewer, h.spaceId, "2026-12"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await problemOf(await createPlan(marta, h.spaceId, "2026-12"))).toEqual([404, "SpaceNotFound"]);
    const anonymous = await call(createPlanRoute, "POST", plansPath(h.spaceId), {
      params: { spaceId: h.spaceId },
      body: { period: "2026-12" },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    // None of the refused attempts stored the period, so an admin still creates it.
    expect((await createPlan(admin, h.spaceId, "2026-12")).status).toBe(201);
  });

  it("answers a malformed space id with SpaceNotFound, never a 500", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await createPlan(ana, "not-a-uuid", "2026-11"))).toEqual([404, "SpaceNotFound"]);
  });

  it("refuses a plan in an archived space (HU-E1-09)", async () => {
    const h = await household();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    expect(await problemOf(await createPlan(h.ana, h.spaceId, "2026-11"))).toEqual([409, "SpaceArchived"]);
  });

  it("gives a personal space a plan with Ana as its only member", async () => {
    const ana = await registerUser("Ana");
    const plan = await newPlan(ana, ana.spaceId, "2026-11");
    expect([plan.status, plan.capacities.length]).toEqual(["DRAFT", 1]);
  });

  it("gives a semi-monthly space two plans per month", async () => {
    const ana = await registerUser("Ana");
    const semi = await patchSpace(ana, ana.spaceId, {
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
    });
    expect(semi.status).toBe(200);
    const h1 = await newPlan(ana, ana.spaceId, "2026-11 H1");
    const h2 = await newPlan(ana, ana.spaceId, "2026-11 H2");
    expect([h1.period, h2.period]).toEqual([
      { label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" },
      { label: "2026-11 H2", startDate: "2026-11-16", endDate: "2026-11-30" },
    ]);
    expect(h1.id).not.toBe(h2.id);
  });

  it("refuses a label that names no period of the policy, and a malformed body", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await createPlan(ana, ana.spaceId, "2026-13"))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
    expect(await problemOf(await createPlan(ana, ana.spaceId, "2026-11".padEnd(21, " ")))).toEqual([
      422,
      "ValidationFailed",
    ]);
    const malformed = await call(createPlanRoute, "POST", plansPath(ana.spaceId), {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { period: 202611 },
    });
    expect(await problemOf(malformed)).toEqual([422, "ValidationFailed"]);
  });
});

describe("read a plan (HU-E6-01)", () => {
  it("reads the plan back with its ETag, and a plan without capacities has null shares and an Unbudgeted line at zero", async () => {
    const h = await household();
    const plan = await newPlan(h.ana, h.spaceId, "2026-11");
    const read = await getPlan(h.juan, h.spaceId, plan.id);
    expect([read.status, read.headers.get("etag")]).toEqual([200, '"1"']);
    const body = await read.json();
    expect(body).toEqual(plan);
    expect(body.capacities).toEqual([
      { memberId: h.ana.memberId, amount: cop(0), share: null },
      { memberId: h.juan.memberId, amount: cop(0), share: null },
    ]);
    expect([body.lines, body.totalCapacity, body.planned, body.unallocated]).toEqual([
      [],
      cop(0),
      cop(0),
      cop(0),
    ]);
    expect(body.unbudgeted).toEqual({ spent: cop(0), available: cop(0) });
  });

  it("lets every member read, a VIEWER included", async () => {
    const h = await household();
    const viewer = await registerUser("Vera");
    await joinAs(h.ana, h.spaceId, viewer, "VIEWER");
    const plan = await newPlan(h.ana, h.spaceId, "2026-11");
    for (const reader of [h.ana, h.juan, viewer]) {
      const read = await getPlan(reader, h.spaceId, plan.id);
      expect([read.status, read.headers.get("etag")]).toEqual([200, '"1"']);
    }
    expect((await planOf(viewer, h.spaceId, plan.id)).id).toBe(plan.id);
  });

  it("hides plans from non-members, other spaces and malformed ids (Review Focus 5)", async () => {
    const h = await household();
    const marta = await registerUser("Marta");
    const plan = await newPlan(h.ana, h.spaceId, "2026-11");
    expect(await problemOf(await getPlan(marta, h.spaceId, plan.id))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getPlan(h.ana, "not-a-uuid", plan.id))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getPlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await getPlan(h.ana, h.spaceId, crypto.randomUUID()))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    const personal = await newPlan(h.ana.personal, h.ana.personal.spaceId, "2026-11");
    expect(await problemOf(await getPlan(h.ana, h.spaceId, personal.id))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await getPlan(h.ana.personal, h.ana.personal.spaceId, plan.id))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    const anonymous = await call(getPlanRoute, "GET", plansPath(h.spaceId, `/${plan.id}`), {
      params: { spaceId: h.spaceId, planId: plan.id },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("keeps answering reads in an archived space (HU-E1-09)", async () => {
    const h = await household();
    const plan = await newPlan(h.ana, h.spaceId, "2026-11");
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    for (const reader of [h.ana, h.juan]) {
      const read = await getPlan(reader, h.spaceId, plan.id);
      expect([read.status, read.headers.get("etag")]).toEqual([200, '"1"']);
      expect(await read.json()).toEqual(plan);
    }
  });

  it("computes the spending on read, within the plan's stored dates", async () => {
    const ana = await registerUser("Ana");
    const accountId = await newAccount(ana, "Bancolombia", 2_000_000);
    const categoryId = await categoryWithKey(ana, "groceries");
    const spendOn = async (date: string, pesos: number) =>
      expect(
        (
          await post(recordExpense, ana, "expenses", {
            description: "Market",
            amount: cop(pesos),
            date,
            categoryId,
            accountId,
          })
        ).status,
      ).toBe(201);
    const plan = await newPlan(ana, ana.spaceId, "2026-11");
    expect((await patchSpace(ana, ana.spaceId, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(
      200,
    );
    await spendOn("2026-10-28", 40_000);
    await spendOn("2026-11-01", 85_000);
    await spendOn("2026-11-30", 15_000);
    await spendOn("2026-12-01", 60_000);
    const read = await planOf(ana, ana.spaceId, plan.id);
    expect(read.unbudgeted).toEqual({ spent: cop(100_000), available: cop(-100_000) });
    expect([read.period, read.version]).toEqual([plan.period, 1]);
  });
});

describe("plans keep their stored boundaries (D10, D6, Review Focus 4)", () => {
  it("keeps the 2026-11 plan's dates after the policy moves to the 25th, and starts the next plan after it", async () => {
    const ana = await registerUser("Ana");
    await newPlan(ana, ana.spaceId, "2026-11");
    expect((await patchSpace(ana, ana.spaceId, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(
      200,
    );
    expect(await periods(ana, ana.spaceId, "?from=2026-11-10&count=2")).toEqual([
      { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-24" },
    ]);
    const december = await newPlan(ana, ana.spaceId, "2026-12");
    expect(december.period).toEqual({ label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-24" });
  });

  it("lists the ledger's ?period=2026-11 with the plan's stored dates after the policy moves to the 25th", async () => {
    const ana = await registerUser("Ana");
    const accountId = await newAccount(ana, "Bancolombia", 2_000_000);
    const categoryId = await categoryWithKey(ana, "groceries");
    const spendOn = async (date: string) =>
      expect(
        (
          await post(recordExpense, ana, "expenses", {
            description: "Market",
            amount: cop(85_000),
            date,
            categoryId,
            accountId,
          })
        ).status,
      ).toBe(201);
    await newPlan(ana, ana.spaceId, "2026-11");
    expect((await patchSpace(ana, ana.spaceId, { periodPolicy: { kind: "MONTHLY", day: 25 } })).status).toBe(
      200,
    );
    // The new policy alone would label 2026-10-25 to 2026-11-24 as 2026-11; the plan keeps 2026-11-01 to 2026-11-30.
    await spendOn("2026-10-28");
    await spendOn("2026-11-28");
    const response = await call(listTransactions, "GET", inSpace(ana, "transactions?period=2026-11"), {
      user: ana,
      params: { spaceId: ana.spaceId },
    });
    const page = (await response.json()) as { period: unknown; items: { date: string }[] };
    expect(page.period).toEqual({ label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(page.items.map((t) => t.date)).toEqual(["2026-11-28"]);
  });

  it("locks the space currency once a plan exists", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana, "Trip");
    expect((await patchSpace(ana, spaceId, { currency: "USD" })).status).toBe(200);
    expect((await patchSpace(ana, spaceId, { currency: "COP" })).status).toBe(200);
    await newPlan(ana, spaceId, "2026-11");
    expect(await problemOf(await patchSpace(ana, spaceId, { currency: "USD" }))).toEqual([
      409,
      "SpaceCurrencyLocked",
    ]);
  });
});
