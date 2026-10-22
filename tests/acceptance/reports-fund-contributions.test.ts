import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { newPlan } from "../support/budgeting";
import { cop } from "../support/ledger";
import {
  contribute,
  getFundContributions,
  getMemberMatrix,
  reportHousehold,
  type FundContributionsDto,
  type MemberMatrixDto,
} from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const fundTrackingOf = async (user: TestUser, spaceId: string, period: string) => {
  const response = await getFundContributions(user, spaceId, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as FundContributionsDto;
};
const trackingOf = async (user: TestUser, spaceId: string, period: string) =>
  (await fundTrackingOf(user, spaceId, period)).members.map((m) => [
    m.memberId,
    m.expected,
    m.actual,
    m.difference,
  ]);

describe("fund contribution tracking over HTTP (HU-E7-03)", () => {
  it("compares expected and actual contributions, leaving out those dated outside the period (@golden)", async () => {
    const { h, fund } = await reportHousehold();
    await contribute(h.ana, fund, 480_000, "2026-11-02");
    await contribute(h.juan, fund, 500_000, "2026-11-03");
    await contribute(h.juan, fund, 720_000, "2026-10-31");
    expect(await trackingOf(h.ana, h.spaceId, "2026-11")).toEqual([
      [h.ana.memberId, cop(480_000), cop(480_000), cop(0)],
      [h.juan.memberId, cop(720_000), cop(500_000), cop(-220_000)],
    ]);
    expect((await fundTrackingOf(h.ana, h.spaceId, "2026-11")).totals).toEqual({
      expected: cop(1_200_000),
      actual: cop(980_000),
      difference: cop(-220_000),
    });
  });

  it("expects what the matrix assigns on the plan's SHARED_FUND lines", async () => {
    const { h, planId } = await reportHousehold();
    const tracking = await fundTrackingOf(h.ana, h.spaceId, "2026-11");
    const matrixResponse = await getMemberMatrix(h.ana, h.spaceId, { period: "2026-11" });
    expect(matrixResponse.status).toBe(200);
    const matrix = (await matrixResponse.json()) as MemberMatrixDto;

    expect(tracking.plan).toEqual({ id: planId, status: "DRAFT" });
    const fundLines = matrix.lines.filter((l) => l.funding === "SHARED_FUND");
    expect(fundLines.length).toBeGreaterThan(0);
    for (const member of tracking.members) {
      const assigned = fundLines.reduce(
        (sum, line) =>
          sum + BigInt(line.members.find((c) => c.memberId === member.memberId)!.assigned?.amount ?? "0"),
        0n,
      );
      expect(BigInt(member.expected.amount)).toBe(assigned);
    }
    expect(tracking.members.map((m) => m.expected)).toEqual([cop(480_000), cop(720_000)]);
  });

  it("expects nothing from anyone in the 2026-12 plan, which has no SHARED_FUND line", async () => {
    const { h, fund } = await reportHousehold();
    await newPlan(h.ana, h.spaceId, "2026-12");
    await contribute(h.ana, fund, 100_000, "2026-12-01");
    expect(await trackingOf(h.juan, h.spaceId, "2026-12")).toEqual([
      [h.ana.memberId, cop(0), cop(100_000), cop(100_000)],
      [h.juan.memberId, cop(0), cop(0), cop(0)],
    ]);
  });

  it("answers 401 without a session, before it looks at the space or the period (issue 131)", async () => {
    const { h } = await reportHousehold();
    for (const query of ["period=2026-11", "period=not-a-period", ""]) {
      const anonymous = await call(
        fundRoute,
        "GET",
        `/api/v1/spaces/${h.spaceId}/reports/fund-contributions?${query}`,
        { params: { spaceId: h.spaceId } },
      );
      expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    }
    expect((await getFundContributions(h.ana, h.spaceId, { period: "2026-11" })).status).toBe(200);
  });

  it("hides the space from non-members and rejects malformed ids and period labels", async () => {
    const { h } = await reportHousehold();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getFundContributions(marta, h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getFundContributions(h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getFundContributions(h.ana, h.spaceId, { period: "2026-11 H2" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
});
