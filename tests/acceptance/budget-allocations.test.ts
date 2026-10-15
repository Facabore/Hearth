import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import {
  lineNamed,
  planOf,
  putAllocation,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { addGuest, cop } from "../support/ledger";

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
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: h.juan,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
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
