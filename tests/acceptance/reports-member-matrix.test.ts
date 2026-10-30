import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createCategory } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { activatePlan, putAllocation } from "../support/budgeting";
import { cop, inSpace, joinHousehold, type MoneyDto } from "../support/ledger";
import {
  getLineDashboard,
  getMemberMatrix,
  reportHousehold,
  spend,
  type LineDashboardDto,
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

/** The E7 household with its 2026-11 plan ACTIVE, so expenses without a split follow their line's allocation. */
const activeHousehold = async (
  beforeActivation?: (r: Awaited<ReturnType<typeof reportHousehold>>) => Promise<void>,
) => {
  const r = await reportHousehold();
  await beforeActivation?.(r);
  expect((await activatePlan(r.h.ana, r.h.spaceId, r.planId)).status).toBe(200);
  return r;
};
const matrixOf = async (user: TestUser, spaceId: string): Promise<MemberMatrixDto> => {
  const response = await getMemberMatrix(user, spaceId, { period: "2026-11" });
  expect(response.status).toBe(200);
  return (await response.json()) as MemberMatrixDto;
};
const cells = (matrix: MemberMatrixDto, name: string) =>
  matrix.lines
    .find((l) => l.name === name)!
    .members.map((c) => [c.memberId, c.assigned, c.contributed, c.consumed, c.gap, c.status]);

/** HU-E3-04: a subcategory of `parentCategoryId`, created by `user`. */
const subcategory = async (user: TestUser, parentCategoryId: string, name: string): Promise<string> => {
  const response = await call(createCategory, "POST", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
    body: { parentCategoryId, name },
  });
  if (response.status !== 201) throw new Error(`subcategory failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

describe("member by line matrix over HTTP (HU-E7-02)", () => {
  it("gives Home's row from expenses split BY_ALLOCATION (@critical @golden)", async () => {
    const r = await activeHousehold();
    await spend(r.h.ana, r.category.groceries, 900_000, "2026-11-05");
    await spend(r.h.juan, r.category.utilities, 400_000, "2026-11-10");
    const matrix = await matrixOf(r.h.ana, r.h.spaceId);
    expect(matrix.plan).toEqual({ id: r.planId, status: "ACTIVE" });
    expect(matrix.lines.find((l) => l.name === "Home")?.reason).toBeNull();
    expect(cells(matrix, "Home")).toEqual([
      [r.h.ana.memberId, cop(588_000), cop(900_000), cop(520_000), cop(312_000), "OVER_CONTRIBUTED"],
      [r.h.juan.memberId, cop(882_000), cop(400_000), cop(780_000), cop(-482_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("defers Rent's contribution to the fund: the fund's rent consumed 480,000 and 720,000 COP", async () => {
    const r = await activeHousehold();
    await spend(r.h.ana, r.category.rent, 1_200_000, "2026-11-01", r.fund);
    const matrix = await matrixOf(r.h.juan, r.h.spaceId);
    expect(matrix.lines.find((l) => l.name === "Rent")?.reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(cells(matrix, "Rent")).toEqual([
      [r.h.ana.memberId, cop(480_000), null, cop(480_000), null, null],
      [r.h.juan.memberId, cop(720_000), null, cop(720_000), null, null],
    ]);
  });

  it("reports only consumption on Free once it has no allocation: Ana's 50,000 COP split EQUAL", async () => {
    const r = await activeHousehold(async ({ h, planId, lineId }) => {
      expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), { rule: "NONE" })).status).toBe(
        200,
      );
    });
    await spend(r.h.ana, r.category.entertainment, 50_000, "2026-11-12");
    const matrix = await matrixOf(r.h.ana, r.h.spaceId);
    expect(matrix.lines.find((l) => l.name === "Free")).toMatchObject({
      rule: "NONE",
      reason: "NOT_ALLOCATED",
    });
    expect(cells(matrix, "Free")).toEqual([
      [r.h.ana.memberId, null, null, cop(25_000), null, null],
      [r.h.juan.memberId, null, null, cop(25_000), null, null],
    ]);
  });

  it("answers 401 without a session, before it looks at the space or the period (issue 131)", async () => {
    const r = await reportHousehold();
    for (const query of ["period=2026-11", "period=not-a-period", ""]) {
      const anonymous = await call(
        matrixRoute,
        "GET",
        `/api/v1/spaces/${r.h.spaceId}/reports/member-matrix?${query}`,
        { params: { spaceId: r.h.spaceId } },
      );
      expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    }
    expect((await getMemberMatrix(r.h.ana, r.h.spaceId, { period: "2026-11" })).status).toBe(200);
  });

  it("lets VIEWER Sofi read the matrix, where she has nothing assigned, and hides it from non-members", async () => {
    const r = await activeHousehold();
    const sofi = await joinHousehold(r.h, "Sofi", "VIEWER");
    const matrix = await matrixOf(sofi, r.h.spaceId);
    expect(cells(matrix, "Home").find(([memberId]) => memberId === sofi.memberId)).toEqual([
      sofi.memberId,
      cop(0),
      cop(0),
      cop(0),
      cop(0),
      "ON_TARGET",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getMemberMatrix(marta, r.h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getMemberMatrix(r.h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getMemberMatrix(r.h.ana, r.h.spaceId, { period: "2026-11 H2" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });

  it("shows nothing but member figures: exactly the documented cell keys and no account field (D9)", async () => {
    const r = await activeHousehold();
    await spend(r.h.ana, r.category.rent, 1_200_000, "2026-11-01", r.fund);
    await spend(r.h.ana, r.category.groceries, 900_000, "2026-11-05");
    const response = await getMemberMatrix(r.h.juan, r.h.spaceId, { period: "2026-11" });
    const matrix = (await response.json()) as MemberMatrixDto;
    const keys = matrix.lines.flatMap((l) => l.members.map((c) => Object.keys(c).sort()));
    expect(keys.length).toBeGreaterThan(0);
    for (const cellKeys of keys) {
      expect(cellKeys).toEqual(["assigned", "consumed", "contributed", "gap", "memberId", "status"]);
    }
    expect(JSON.stringify(matrix)).not.toMatch(/account/i);
  });

  it("answers each member's total gap over Home and Savings, fund-level Rent left out (#213, ruling P262)", async () => {
    const r = await activeHousehold();
    const sofi = await joinHousehold(r.h, "Sofi", "VIEWER");
    await spend(r.h.ana, r.category.rent, 1_200_000, "2026-11-01", r.fund);
    await spend(r.h.ana, r.category.groceries, 900_000, "2026-11-05");
    await spend(r.h.juan, r.category.utilities, 400_000, "2026-11-10");
    const matrix = (await matrixOf(sofi, r.h.spaceId)) as MemberMatrixDto & {
      members: { memberId: string; gap: MoneyDto | null; status: string | null }[];
    };
    // Home +312,000 and Savings −240,000 for Ana; Home −482,000 and Savings −360,000 for Juan.
    expect(matrix.members).toEqual([
      { memberId: r.h.ana.memberId, gap: cop(72_000), status: "OVER_CONTRIBUTED" },
      { memberId: r.h.juan.memberId, gap: cop(-842_000), status: "UNDER_CONTRIBUTED" },
      { memberId: sofi.memberId, gap: cop(0), status: "ON_TARGET" },
    ]);
    // The per-line rows answer what they answered before.
    expect(cells(matrix, "Home")[0]).toEqual([
      r.h.ana.memberId,
      cop(588_000),
      cop(900_000),
      cop(520_000),
      cop(312_000),
      "OVER_CONTRIBUTED",
    ]);
  });

  it("answers no member totals for a period without a plan", async () => {
    const r = await activeHousehold();
    const response = await getMemberMatrix(r.h.ana, r.h.spaceId, { period: "2026-12" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: null, lines: [], members: [] });
  });

  it("counts a subcategory's expense on its parent's line and reconciles with the line dashboard (P96)", async () => {
    const r = await activeHousehold();
    const vegetables = await subcategory(r.h.ana, r.category.groceries, "Vegetables");
    await spend(r.h.ana, r.category.groceries, 900_000, "2026-11-05");
    await spend(r.h.juan, vegetables, 100_000, "2026-11-08");
    await spend(r.h.juan, r.category.utilities, 400_000, "2026-11-10");
    await spend(r.h.ana, r.category.rent, 1_200_000, "2026-11-01", r.fund);
    const matrix = await matrixOf(r.h.ana, r.h.spaceId);
    const dashboardResponse = await getLineDashboard(r.h.ana, r.h.spaceId, { period: "2026-11" });
    expect(dashboardResponse.status).toBe(200);
    const dashboard = (await dashboardResponse.json()) as LineDashboardDto;

    const consumedOf = (name: string) =>
      matrix.lines
        .find((l) => l.name === name)!
        .members.reduce((sum, c) => sum + BigInt(c.consumed!.amount), 0n);
    expect(consumedOf("Home")).toBe(140_000_000n);
    for (const line of matrix.lines.filter((l) => l.members.every((c) => c.consumed !== null))) {
      expect(consumedOf(line.name)).toBe(
        BigInt(dashboard.lines.find((d) => d.name === line.name)!.spent.amount),
      );
    }
  });
});
