import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addLine,
  deleteLine,
  lineNamed,
  newPlan,
  patchLine,
  planOf,
  putAllocation,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { addGuest, cop, joinHousehold, type MoneyDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const assignedOn = (plan: PlanDto, name: string) =>
  lineNamed(plan, name).allocation.members.map((m) => [m.memberId, m.assigned]);
const allocated = async (...args: Parameters<typeof putAllocation>): Promise<PlanDto> => {
  const response = await putAllocation(...args);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanDto;
};
const percents = (ana: string, juan: string, anaPercent: string, juanPercent: string) => ({
  rule: "PERCENT",
  members: [
    { memberId: ana, percent: anaPercent },
    { memberId: juan, percent: juanPercent },
  ],
});
const amounts = (ana: string, juan: string, anaPesos: number, juanPesos: number) => ({
  rule: "FIXED",
  members: [
    { memberId: ana, amount: cop(anaPesos) },
    { memberId: juan, amount: cop(juanPesos) },
  ],
});

const percentBody = (...members: [memberId: string, percent: string][]) => ({
  rule: "PERCENT",
  members: members.map(([memberId, percent]) => ({ memberId, percent })),
});
const fixedBody = (...members: [memberId: string, amount: MoneyDto][]) => ({
  rule: "FIXED",
  members: members.map(([memberId, amount]) => ({ memberId, amount })),
});

/**
 * Every body is refused as `expected` (the bodies that were not, by name, with what they got instead), and a
 * refusal changes nothing: not the line and not the plan's version, which a plan write bumps before it validates.
 */
const refuses = async (
  user: TestUser,
  at: { spaceId: string; planId: string; lineId: string },
  expected: [number, string],
  bodies: Record<string, unknown>,
) => {
  const before = await planOf(user, at.spaceId, at.planId);
  const others: Record<string, [number, string]> = {};
  for (const [name, body] of Object.entries(bodies)) {
    const problem = await problemOf(await putAllocation(user, at.spaceId, at.planId, at.lineId, body));
    if (problem[0] !== expected[0] || problem[1] !== expected[1]) others[name] = problem;
  }
  expect(others).toEqual({});
  expect(await planOf(user, at.spaceId, at.planId)).toEqual(before);
};

/** The line's stored rule and how many of its allocation rows exist and are still current (not superseded). */
const storedAllocation = async (app: Container, lineId: string) => {
  const { rows } = await app.pool.query(
    `SELECT l.allocation_rule AS rule, count(a.id)::int AS total,
            count(a.id) FILTER (WHERE a.superseded_at IS NULL)::int AS current
       FROM budget_lines l LEFT JOIN budget_allocations a ON a.line_id = l.id
      WHERE l.id = $1 GROUP BY l.id`,
    [lineId],
  );
  return rows[0];
};

/** `member` leaves the household. */
const leaves = async (member: TestUser, spaceId: string) => {
  const left = await call(leaveSpace, "POST", `/api/v1/spaces/${spaceId}/leave`, {
    user: member,
    params: { spaceId },
  });
  expect(left.status).toBe(204);
};

describe("line allocation rules (HU-E6-05)", () => {
  it("allocates Home proportionally by default: Ana 588,000 and Juan 882,000 COP (golden)", async () => {
    const { h, plan } = await referencePlan();
    expect(lineNamed(plan, "Home").allocation.rule).toBe("PROPORTIONAL");
    expect(assignedOn(plan, "Home")).toEqual([
      [h.ana.memberId, cop(588_000)],
      [h.juan.memberId, cop(882_000)],
    ]);
  });

  it("allocates Free at 42 % / 58 %: Ana 306,600 and Juan 423,400 COP (golden)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const body = percents(h.ana.memberId, h.juan.memberId, "42", "58");
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Free"), body);
    expect(lineNamed(plan, "Free").allocation.members).toEqual([
      { memberId: h.ana.memberId, percent: "42.00", amount: null, assigned: cop(306_600) },
      { memberId: h.juan.memberId, percent: "58.00", amount: null, assigned: cop(423_400) },
    ]);
  });

  it("allocates Savings by fixed amounts: Ana 200,000 and Juan 400,000 COP", async () => {
    const { h, planId, lineId } = await referencePlan();
    const body = amounts(h.ana.memberId, h.juan.memberId, 200_000, 400_000);
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Savings"), body);
    expect(lineNamed(plan, "Savings").allocation.members).toEqual([
      { memberId: h.ana.memberId, percent: null, amount: cop(200_000), assigned: cop(200_000) },
      { memberId: h.juan.memberId, percent: null, amount: cop(400_000), assigned: cop(400_000) },
    ]);
  });

  it("refuses values that do not add up: Free at 42 % / 57 % and Savings at 200,000 / 350,000 COP", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = percents(h.ana.memberId, h.juan.memberId, "42", "57");
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), free))).toEqual([
      422,
      "InvalidAllocation",
    ]);
    const savings = amounts(h.ana.memberId, h.juan.memberId, 200_000, 350_000);
    expect(
      await problemOf(await putAllocation(h.ana, h.spaceId, planId, lineId("Savings"), savings)),
    ).toEqual([422, "InvalidAllocation"]);
  });

  it("leaves Free unassigned as group money with NONE, reporting only planned, spent and available", async () => {
    const { h, planId, lineId } = await referencePlan();
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" });
    expect(lineNamed(plan, "Free")).toMatchObject({
      plannedAmount: cop(730_000),
      spent: cop(0),
      available: cop(730_000),
      allocation: { rule: "NONE", members: [], error: null },
    });
  });

  it("flags Home with InvalidAllocation while every capacity is 0 (Review Focus 3)", async () => {
    const { h, planId } = await referencePlan();
    const plan = await setCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 0],
      [h.juan.memberId, 0],
    ]);
    expect(lineNamed(plan, "Home").allocation).toMatchObject({
      rule: "PROPORTIONAL",
      error: "InvalidAllocation",
    });
    expect(assignedOn(plan, "Home")).toEqual([
      [h.ana.memberId, null],
      [h.juan.memberId, null],
    ]);
  });

  it("allocates to the guest Pedro like anyone (D15)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const pedro = await addGuest(h, "Pedro");
    const body = { rule: "FIXED", members: [{ memberId: pedro, amount: cop(600_000) }] };
    const plan = await allocated(h.ana, h.spaceId, planId, lineId("Savings"), body);
    expect(assignedOn(plan, "Savings")).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [pedro, cop(600_000)],
    ]);
  });

  it("flags Free once Juan, allocated 58 %, leaves the household (Review Focus 2)", async () => {
    const { h, planId, lineId } = await referencePlan();
    await allocated(
      h.ana,
      h.spaceId,
      planId,
      lineId("Free"),
      percents(h.ana.memberId, h.juan.memberId, "42", "58"),
    );
    await leaves(h.juan, h.spaceId);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect(lineNamed(plan, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: h.ana.memberId, percent: "42.00", amount: null, assigned: null }],
      error: "InvalidAllocation",
    });
    expect(assignedOn(plan, "Home")).toEqual([[h.ana.memberId, cop(1_470_000)]]);
    expect([plan.totalCapacity, plan.unallocated]).toEqual([cop(1_600_000), cop(-2_400_000)]);
  });

  it("supersedes the earlier values when a line is allocated again, keeping their rows (D8, Review Focus 6)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = lineId("Free");
    await allocated(h.ana, h.spaceId, planId, free, percents(h.ana.memberId, h.juan.memberId, "42", "58"));
    await allocated(h.ana, h.spaceId, planId, free, { rule: "PROPORTIONAL" });
    const { rows } = await app.pool.query(
      "SELECT value::text AS value, superseded_at IS NOT NULL AS superseded FROM budget_allocations WHERE line_id = $1 ORDER BY value",
      [free],
    );
    expect(rows).toEqual([
      { value: "4200", superseded: true },
      { value: "5800", superseded: true },
    ]);
  });

  it("refuses MEMBER Juan, a stale If-Match, an id that is not a member and a malformed percentage", async () => {
    const { h, planId, lineId, plan } = await referencePlan();
    const home = lineId("Home");
    const juans = await putAllocation(h.juan, h.spaceId, planId, home, { rule: "NONE" });
    expect(await problemOf(juans)).toEqual([403, "InsufficientRole"]);
    const stale = await putAllocation(h.ana, h.spaceId, planId, home, { rule: "NONE" }, plan.version - 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    const stranger = { rule: "PERCENT", members: [{ memberId: "not-a-member", percent: "100" }] };
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, home, stranger))).toEqual([
      422,
      "NotASpaceMember",
    ]);
    const malformed = { rule: "PERCENT", members: [{ memberId: h.ana.memberId, percent: "4.123" }] };
    expect(await problemOf(await putAllocation(h.ana, h.spaceId, planId, home, malformed))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });
});

describe("who may allocate a line, and where (HU-E6-05)", () => {
  it("lets an ADMIN allocate and answers the plan with its new ETag, but refuses MEMBER Juan and a VIEWER", async () => {
    const { h, planId, lineId } = await referencePlan();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    const free = lineId("Free");
    const before = await planOf(h.ana, h.spaceId, planId);
    const forbidden: [number, string] = [403, "InsufficientRole"];
    await refuses(h.juan, { spaceId: h.spaceId, planId, lineId: free }, forbidden, {
      NONE: { rule: "NONE" },
    });
    await refuses(vera, { spaceId: h.spaceId, planId, lineId: free }, forbidden, { NONE: { rule: "NONE" } });

    const response = await putAllocation(luis, h.spaceId, planId, free, { rule: "NONE" }, before.version);
    expect([response.status, response.headers.get("etag")]).toEqual([200, `"${before.version + 1}"`]);
    const plan = (await response.json()) as PlanDto;
    expect(lineNamed(plan, "Free").allocation).toEqual({ rule: "NONE", members: [], error: null });
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("answers 404 to a stranger, a malformed space or plan, another household's plan, and a line that is not the plan's", async () => {
    const { h, planId, lineId } = await referencePlan();
    const marta = await registerUser("Marta");
    const free = lineId("Free");
    const none = { rule: "NONE" };
    expect(await problemOf(await putAllocation(marta, h.spaceId, planId, free, none))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await putAllocation(h.ana, "not-a-uuid", planId, free, none))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    for (const planOfElsewhere of [foreign.id, "not-a-uuid"]) {
      const response = await putAllocation(h.ana, h.spaceId, planOfElsewhere, free, none);
      expect(await problemOf(response)).toEqual([404, "BudgetPlanNotFound"]);
    }

    const { id: december } = await newPlan(h.ana, h.spaceId, "2026-12");
    await setCapacities(h.ana, h.spaceId, december, [[h.ana.memberId, 1_600_000]]);
    const later = lineNamed(
      await addLine(h.ana, h.spaceId, december, { name: "Food", pesos: 500_000 }),
      "Food",
    );
    const other = await referencePlan();
    expect((await deleteLine(h.ana, h.spaceId, planId, lineId("Rent"))).status).toBe(200);
    for (const lineOfElsewhere of [
      later.id,
      other.lineId("Home"),
      lineId("Rent"),
      "0190a000-0000-7000-8000-000000000000",
      "not-a-uuid",
    ]) {
      const response = await putAllocation(h.ana, h.spaceId, planId, lineOfElsewhere, none);
      expect(await problemOf(response)).toEqual([404, "BudgetLineNotFound"]);
    }
    expect((await planOf(h.ana, h.spaceId, december)).lines.map((l) => l.allocation.rule)).toEqual([
      "PROPORTIONAL",
    ]);
    const home = lineNamed(await planOf(other.h.ana, other.h.spaceId, other.planId), "Home");
    expect(home.allocation.rule).toBe("PROPORTIONAL");
  });

  it("refuses an allocation in an archived space (HU-E1-09), and the allocation stays", async () => {
    const { h, planId, lineId } = await referencePlan();
    const free = lineId("Free");
    const body = amounts(h.ana.memberId, h.juan.memberId, 300_000, 430_000);
    await allocated(h.ana, h.spaceId, planId, free, body);
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    await refuses(h.ana, { spaceId: h.spaceId, planId, lineId: free }, [409, "SpaceArchived"], {
      NONE: { rule: "NONE" },
      PROPORTIONAL: { rule: "PROPORTIONAL" },
    });
    expect(assignedOn(await planOf(h.ana, h.spaceId, planId), "Free")).toEqual([
      [h.ana.memberId, cop(300_000)],
      [h.juan.memberId, cop(430_000)],
    ]);
  });
});

describe("allocation values (HU-E6-05)", () => {
  it("lets one member hold a whole line, and splits 33.33 / 33.33 / 33.34 % with a guest to the peso", async () => {
    const { h, planId, lineId } = await referencePlan();
    const pedro = await addGuest(h, "Pedro");
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const whole = await allocated(h.ana, h.spaceId, planId, lineId("Free"), percentBody([ana, "100"]));
    expect(lineNamed(whole, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: ana, percent: "100.00", amount: null, assigned: cop(730_000) },
        { memberId: juan, percent: null, amount: null, assigned: cop(0) },
        { memberId: pedro, percent: null, amount: null, assigned: cop(0) },
      ],
      error: null,
    });
    const body = percentBody([ana, "33.33"], [juan, "33.33"], [pedro, "33.34"]);
    const split = await allocated(h.ana, h.spaceId, planId, lineId("Free"), body);
    expect(lineNamed(split, "Free").allocation.members).toEqual([
      { memberId: ana, percent: "33.33", amount: null, assigned: cop(243_309) },
      { memberId: juan, percent: "33.33", amount: null, assigned: cop(243_309) },
      { memberId: pedro, percent: "33.34", amount: null, assigned: cop(243_382) },
    ]);
  });

  it("refuses percentages that are not positive or do not make 100 %, a member listed twice, and none", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    await refuses(h.ana, at, [422, "InvalidAllocation"], {
      "99.99 %": percentBody([ana, "99.99"]),
      "100.01 %": percentBody([ana, "100.01"]),
      "50 % and 51 %": percentBody([ana, "50"], [juan, "51"]),
      "100 % and 0 %": percentBody([ana, "100"], [juan, "0"]),
      "50 % twice for Ana": percentBody([ana, "50"], [ana, "50"]),
      "no members": percentBody(),
    });
  });

  it("refuses fixed amounts that are not positive or do not add up to the planned amount, a member twice, and none", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    await refuses(h.ana, at, [422, "InvalidAllocation"], {
      "700,000 in all": fixedBody([ana, cop(300_000)], [juan, cop(400_000)]),
      "750,000 in all": fixedBody([ana, cop(300_000)], [juan, cop(450_000)]),
      "730,000 and 0": fixedBody([ana, cop(730_000)], [juan, cop(0)]),
      "830,000 and -100,000": fixedBody([ana, cop(830_000)], [juan, cop(-100_000)]),
      "365,000 twice for Ana": fixedBody([ana, cop(365_000)], [ana, cop(365_000)]),
      "no members": fixedBody(),
    });
  });

  it("refuses amounts in another currency than the space's, an unknown one and a malformed one", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    // 73,000,000 minor units are the planned amount, so only the currency can be what refuses them.
    await refuses(h.ana, at, [422, "CurrencyMismatch"], {
      "all in USD": fixedBody([ana, { amount: "73000000", currency: "USD" }]),
      "Juan's part in USD": fixedBody([ana, cop(300_000)], [juan, { amount: "43000000", currency: "USD" }]),
    });
    await refuses(h.ana, at, [422, "UnknownCurrency"], {
      ZZZ: fixedBody([ana, { amount: "73000000", currency: "ZZZ" }]),
    });
    await refuses(h.ana, at, [422, "ValidationFailed"], {
      "lowercase code": fixedBody([ana, { amount: "73000000", currency: "cop" }]),
      "fractional amount": fixedBody([ana, { amount: "730000.5", currency: "COP" }]),
    });
  });

  it("refuses a member who left, another household's member and an id that is not a uuid", async () => {
    const { h, planId, lineId } = await referencePlan();
    const elsewhere = await referencePlan();
    await leaves(h.juan, h.spaceId);
    const [ana, juan, stranger] = [h.ana.memberId, h.juan.memberId, elsewhere.h.ana.memberId];
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    await refuses(h.ana, at, [422, "NotASpaceMember"], {
      "Juan, who left, at 100 %": percentBody([juan, "100"]),
      "Juan, who left, at 730,000": fixedBody([juan, cop(730_000)]),
      "another household's Ana at 100 %": percentBody([stranger, "100"]),
      "another household's Ana at 730,000": fixedBody([stranger, cop(730_000)]),
      "not-a-uuid at 50 %": percentBody([ana, "50"], ["not-a-uuid", "50"]),
      "not-a-uuid at 300,000": fixedBody([ana, cop(430_000)], ["not-a-uuid", cop(300_000)]),
    });
  });

  it("takes at most 100 members per body", async () => {
    const { h, planId, lineId } = await referencePlan();
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    const strangers = (count: number) => Array.from({ length: count }, (_, i) => `member-${i}`);
    const percentFor = (count: number) =>
      percentBody(...strangers(count).map((id): [string, string] => [id, "1"]));
    const fixedFor = (count: number) =>
      fixedBody(...strangers(count).map((id): [string, MoneyDto] => [id, cop(1)]));
    // 100 members pass the schema and meet the membership check; the 101st never gets that far.
    await refuses(h.ana, at, [422, "NotASpaceMember"], {
      "100 percentages": percentFor(100),
      "100 amounts": fixedFor(100),
    });
    await refuses(h.ana, at, [422, "ValidationFailed"], {
      "101 percentages": percentFor(101),
      "101 amounts": fixedFor(101),
    });
  });

  it("validates the body: a known rule, the values of that rule only, and percentages as strings", async () => {
    const { h, planId, lineId } = await referencePlan();
    const ana = h.ana.memberId;
    const at = { spaceId: h.spaceId, planId, lineId: lineId("Free") };
    await refuses(h.ana, at, [422, "ValidationFailed"], {
      "no rule": {},
      "unknown rule": { rule: "SOMETIMES" },
      "lowercase rule": { rule: "none" },
      "PERCENT without members": { rule: "PERCENT" },
      "FIXED without members": { rule: "FIXED" },
      "amounts under PERCENT": { rule: "PERCENT", members: [{ memberId: ana, amount: cop(730_000) }] },
      "percentages under FIXED": { rule: "FIXED", members: [{ memberId: ana, percent: "100" }] },
      "percentage as a number": { rule: "PERCENT", members: [{ memberId: ana, percent: 100 }] },
      "negative percentage": percentBody([ana, "-1"]),
      "percentage of four digits": percentBody([ana, "1000"]),
      "percentage in exponent form": percentBody([ana, "1e2"]),
      "empty member id": percentBody(["", "100"]),
      "member id of 65 characters": percentBody(["x".repeat(65), "100"]),
      "member id as a number": { rule: "PERCENT", members: [{ memberId: 7, percent: "100" }] },
    });
  });
});

describe("allocations that stop adding up, and their history (HU-E6-05, D8)", () => {
  it("flags lines held by a member who leaves (P7) until they are allocated again", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    await allocated(h.ana, h.spaceId, planId, lineId("Free"), amounts(ana, juan, 300_000, 430_000));
    await allocated(h.ana, h.spaceId, planId, lineId("Home"), percents(ana, juan, "60", "40"));
    await leaves(h.juan, h.spaceId);

    const flagged = await planOf(h.ana, h.spaceId, planId);
    expect(lineNamed(flagged, "Free").allocation).toEqual({
      rule: "FIXED",
      members: [{ memberId: ana, percent: null, amount: cop(300_000), assigned: null }],
      error: "InvalidAllocation",
    });
    expect(lineNamed(flagged, "Home").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: ana, percent: "60.00", amount: null, assigned: null }],
      error: "InvalidAllocation",
    });

    await allocated(h.ana, h.spaceId, planId, lineId("Free"), fixedBody([ana, cop(730_000)]));
    const repaired = await allocated(h.ana, h.spaceId, planId, lineId("Home"), percentBody([ana, "100"]));
    expect(lineNamed(repaired, "Free").allocation).toEqual({
      rule: "FIXED",
      members: [{ memberId: ana, percent: null, amount: cop(730_000), assigned: cop(730_000) }],
      error: null,
    });
    expect(lineNamed(repaired, "Home").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: ana, percent: "100.00", amount: null, assigned: cop(1_470_000) }],
      error: null,
    });
  });

  it("reads a FIXED line as invalid once its planned amount is lowered, while a PERCENT line follows it (N6)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    await allocated(h.ana, h.spaceId, planId, lineId("Free"), amounts(ana, juan, 300_000, 430_000));
    await allocated(h.ana, h.spaceId, planId, lineId("Home"), percents(ana, juan, "50", "50"));
    const lower = (name: string, pesos: number) =>
      patchLine(h.ana, h.spaceId, planId, lineId(name), { pesos });
    expect((await lower("Free", 700_000)).status).toBe(200);
    expect((await lower("Home", 1_400_000)).status).toBe(200);

    const lowered = await planOf(h.ana, h.spaceId, planId);
    expect(lineNamed(lowered, "Free")).toMatchObject({
      plannedAmount: cop(700_000),
      allocation: {
        rule: "FIXED",
        members: [
          { memberId: ana, percent: null, amount: cop(300_000), assigned: null },
          { memberId: juan, percent: null, amount: cop(430_000), assigned: null },
        ],
        error: "InvalidAllocation",
      },
    });
    expect(lineNamed(lowered, "Home").allocation.error).toBeNull();
    expect(assignedOn(lowered, "Home")).toEqual([
      [ana, cop(700_000)],
      [juan, cop(700_000)],
    ]);

    const again = amounts(ana, juan, 300_000, 400_000);
    const repaired = await allocated(h.ana, h.spaceId, planId, lineId("Free"), again);
    expect(lineNamed(repaired, "Free").allocation.error).toBeNull();
    expect(assignedOn(repaired, "Free")).toEqual([
      [ana, cop(300_000)],
      [juan, cop(400_000)],
    ]);
  });

  it("keeps the earlier percentages as superseded rows when a line is allocated again, and only the latest are current", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const free = lineId("Free");
    await allocated(h.ana, h.spaceId, planId, free, percents(ana, juan, "42", "58"));
    await allocated(h.ana, h.spaceId, planId, free, percents(ana, juan, "50", "50"));
    const { rows } = await app.pool.query(
      "SELECT value::text AS value, superseded_at IS NOT NULL AS superseded FROM budget_allocations WHERE line_id = $1 ORDER BY value",
      [free],
    );
    expect(rows).toEqual([
      { value: "4200", superseded: true },
      { value: "5000", superseded: false },
      { value: "5000", superseded: false },
      { value: "5800", superseded: true },
    ]);
  });

  it("supersedes a FIXED or PERCENT line's rows when it goes back to NONE or PROPORTIONAL, leaving none current", async () => {
    const { h, planId, lineId } = await referencePlan();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const [free, home] = [lineId("Free"), lineId("Home")];
    await allocated(h.ana, h.spaceId, planId, free, amounts(ana, juan, 300_000, 430_000));
    await allocated(h.ana, h.spaceId, planId, home, percents(ana, juan, "50", "50"));
    expect([await storedAllocation(app, free), await storedAllocation(app, home)]).toEqual([
      { rule: "FIXED", total: 2, current: 2 },
      { rule: "PERCENT", total: 2, current: 2 },
    ]);

    await allocated(h.ana, h.spaceId, planId, free, { rule: "NONE" });
    const plan = await allocated(h.ana, h.spaceId, planId, home, { rule: "PROPORTIONAL" });
    expect([await storedAllocation(app, free), await storedAllocation(app, home)]).toEqual([
      { rule: "NONE", total: 2, current: 0 },
      { rule: "PROPORTIONAL", total: 2, current: 0 },
    ]);
    expect(lineNamed(plan, "Free").allocation).toEqual({ rule: "NONE", members: [], error: null });
    expect(lineNamed(plan, "Home").allocation.members).toEqual([
      { memberId: ana, percent: null, amount: null, assigned: cop(588_000) },
      { memberId: juan, percent: null, amount: null, assigned: cop(882_000) },
    ]);
  });
});
