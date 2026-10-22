import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetFundContributions } from "./get-fund-contributions";

const pesos = (n: number) => BigInt(n) * 100n;
const capacities = [
  { memberId: "member-ana", amount: pesos(1_600_000) },
  { memberId: "member-juan", amount: pesos(2_400_000) },
];
const read = (w: ReturnType<typeof reportingWorld>, period: string, userId = "u-ana") =>
  createGetFundContributions(w.memberDeps)({ spaceId: HOUSEHOLD, userId, period });
const rows = async (w: ReturnType<typeof reportingWorld>, period: string) =>
  unwrap(await read(w, period)).members.map((m) => [m.memberId, m.expected, m.actual, m.difference]);

describe("fund contribution tracking (HU-E7-03)", () => {
  it("compares each member's expected and actual contributions to the fund (@golden)", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    const plan = await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [
      { memberId: "member-ana", amount: pesos(480_000) },
      { memberId: "member-juan", amount: pesos(500_000) },
    ];
    expect(unwrap(await read(w, "2026-11")).plan).toEqual({ id: plan.id, status: "ACTIVE" });
    expect(await rows(w, "2026-11")).toEqual([
      ["member-ana", pesos(480_000), pesos(480_000), 0n],
      ["member-juan", pesos(720_000), pesos(500_000), -pesos(220_000)],
    ]);
  });

  it("answers the totals of expected, actual and difference over the listed members (ruling P201 of M6c)", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [
      { memberId: "member-ana", amount: pesos(480_000) },
      { memberId: "member-juan", amount: pesos(500_000) },
    ];
    expect(unwrap(await read(w, "2026-11")).totals).toEqual({
      expected: pesos(1_200_000),
      actual: pesos(980_000),
      difference: -pesos(220_000),
    });
  });

  it("expects nothing from anyone when the plan has no SHARED_FUND line, and counts what they paid in", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    await w.plan("2026-12", { capacities, lines: [aLine("Home", pesos(1_470_000))] });
    w.sums.contributions["2026-12-01"] = [{ memberId: "member-juan", amount: pesos(100_000) }];
    expect(await rows(w, "2026-12")).toEqual([
      ["member-ana", 0n, 0n, 0n],
      ["member-juan", 0n, pesos(100_000), pesos(100_000)],
    ]);
  });

  it("expects nothing in a period without a plan", async () => {
    const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
    const tracking = unwrap(await read(w, "2027-01"));
    expect(tracking.plan).toBeNull();
    expect(tracking.members.map((m) => m.expected)).toEqual([0n, 0n]);
  });

  it("lists every current member for VIEWER Sofi, and no contribution of a member who left (P7)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { capacities, lines: referenceLines() });
    w.sums.contributions["2026-11-01"] = [{ memberId: "member-luis", amount: pesos(300_000) }];
    const tracking = unwrap(await read(w, "2026-11", "u-sofi"));
    expect(tracking.members.map((m) => [m.memberId, m.actual])).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
    expect(codeOf(await read(w, "2026-11", "u-marta"))).toBe("SpaceNotFound");
  });
});
