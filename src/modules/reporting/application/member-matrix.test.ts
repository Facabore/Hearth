import { describe, expect, it } from "vitest";
import type { BudgetLine } from "@/modules/budgeting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetLineDashboard } from "./get-line-dashboard";
import { createGetMemberLineMatrix, type MemberLineMatrix } from "./get-member-line-matrix";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";
const ANA_AND_JUAN = BUDGET_MEMBERS.slice(0, 2);

/** Spec section 4 with the E7 mappings; Free has no allocation (NONE) and is not the catch-all unless told. */
const parts = (free: Partial<BudgetLine> = {}) => ({
  capacities: [
    { memberId: "member-ana", amount: pesos(1_600_000) },
    { memberId: "member-juan", amount: pesos(2_400_000) },
  ],
  lines: referenceLines().map((l) =>
    l.name === "Free" ? { ...l, allocationRule: "NONE" as const, isCatchAll: false, ...free } : l,
  ),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
    { lineId: "line-free", categoryId: "cat-entertainment" },
  ],
});
const sum = (categoryId: string, memberId: string, paid: number, consumed: number) => ({
  categoryId,
  memberId,
  paid: pesos(paid),
  consumed: pesos(consumed),
});
/**
 * HU-E7-02 Background as the ledger sums it: Ana's 900,000 and Juan's 400,000 COP split BY_ALLOCATION 40 / 60, the
 * fund's 1,200,000 COP Rent split BY_ALLOCATION, and Ana's 50,000 COP Outings (Entertainment) split EQUAL.
 */
const novemberSums = () => [
  sum("cat-groceries", "member-ana", 900_000, 360_000),
  sum("cat-groceries", "member-juan", 0, 540_000),
  sum("cat-utilities", "member-ana", 0, 160_000),
  sum("cat-utilities", "member-juan", 400_000, 240_000),
  sum("cat-rent", "member-ana", 0, 480_000),
  sum("cat-rent", "member-juan", 0, 720_000),
  sum("cat-entertainment", "member-ana", 50_000, 25_000),
  sum("cat-entertainment", "member-juan", 0, 25_000),
];

const world = async (members: readonly SpaceMember[] = ANA_AND_JUAN, free: Partial<BudgetLine> = {}) => {
  const w = reportingWorld({ members });
  await w.plan("2026-11", parts(free));
  w.sums.byCategory[NOVEMBER] = novemberSums();
  return w;
};
const read = (w: Awaited<ReturnType<typeof world>>, userId = "u-ana", period = "2026-11") =>
  createGetMemberLineMatrix(w.memberDeps)({ spaceId: HOUSEHOLD, userId, period });
const lineOf = (matrix: MemberLineMatrix, name: string) => matrix.lines.find((l) => l.name === name)!;
const cells = (matrix: MemberLineMatrix, name: string) =>
  lineOf(matrix, name).members.map((c) => [
    c.memberId,
    c.assigned,
    c.contributed,
    c.consumed,
    c.gap,
    c.status,
  ]);

describe("member by line matrix (HU-E7-02)", () => {
  it("gives Home's DIRECT row per member, Ana over-contributed by 312,000 COP (@golden)", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Home")).toMatchObject({ funding: "DIRECT", rule: "PROPORTIONAL", reason: null });
    expect(cells(matrix, "Home")).toEqual([
      ["member-ana", pesos(588_000), pesos(900_000), pesos(520_000), pesos(312_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(882_000), pesos(400_000), pesos(780_000), -pesos(482_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("defers Rent's contribution to the fund and reports its consumption, 480,000 and 720,000 COP", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Rent").reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(cells(matrix, "Rent")).toEqual([
      ["member-ana", pesos(480_000), null, pesos(480_000), null, null],
      ["member-juan", pesos(720_000), null, pesos(720_000), null, null],
    ]);
  });

  it("reports only consumption on Free, which has no allocation (NONE)", async () => {
    const matrix = unwrap(await read(await world()));
    expect(lineOf(matrix, "Free")).toMatchObject({ rule: "NONE", reason: "NOT_ALLOCATED" });
    expect(cells(matrix, "Free")).toEqual([
      ["member-ana", null, null, pesos(25_000), null, null],
      ["member-juan", null, null, pesos(25_000), null, null],
    ]);
  });

  it("attributes a SAVINGS line's transfers to each counted account's owner, never to a non-member's (P8)", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines.map((l) =>
        l.name === "Savings" ? { ...l, savingsAccountIds: ["acc-savings", "acc-luis-savings"] } : l,
      ),
    });
    w.spending.transfers[NOVEMBER] = [
      { accountId: "acc-savings", amount: pesos(300_000) },
      { accountId: "acc-luis-savings", amount: pesos(50_000) },
    ];
    const matrix = unwrap(await read(w));
    expect(lineOf(matrix, "Savings").reason).toBeNull();
    expect(cells(matrix, "Savings")).toEqual([
      ["member-ana", pesos(240_000), pesos(300_000), null, pesos(60_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(360_000), 0n, null, -pesos(360_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("leaves unmapped spending out without a catch-all line, and puts it on the catch-all line otherwise", async () => {
    const without = await world();
    without.sums.byCategory[NOVEMBER] = [
      ...novemberSums(),
      sum("cat-restaurants", "member-ana", 60_000, 30_000),
    ];
    expect(cells(unwrap(await read(without)), "Free")[0]).toEqual([
      "member-ana",
      null,
      null,
      pesos(25_000),
      null,
      null,
    ]);
    const withCatchAll = await world(ANA_AND_JUAN, { isCatchAll: true });
    withCatchAll.sums.byCategory[NOVEMBER] = [
      ...novemberSums(),
      sum("cat-restaurants", "member-ana", 60_000, 30_000),
    ];
    expect(cells(unwrap(await read(withCatchAll)), "Free")[0]).toEqual([
      "member-ana",
      null,
      null,
      pesos(55_000),
      null,
      null,
    ]);
  });

  it("assigns nobody on Home while its allocation does not hold", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines.map((l) => (l.name === "Home" ? { ...l, allocationRule: "PERCENT" as const } : l)),
      allocations: [{ lineId: "line-home", memberId: "member-ana", value: 5_000n }],
    });
    w.sums.byCategory[NOVEMBER] = novemberSums();
    const matrix = unwrap(await read(w));
    expect(lineOf(matrix, "Home").reason).toBe("INVALID_ALLOCATION");
    expect(cells(matrix, "Home")[0]).toEqual([
      "member-ana",
      null,
      pesos(900_000),
      pesos(520_000),
      null,
      null,
    ]);
  });

  it("lists every current member in join order for VIEWER Sofi, guests included, and nobody who left (P7)", async () => {
    const w = await world(BUDGET_MEMBERS);
    w.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-groceries", "member-luis", 100_000, 0)];
    const matrix = unwrap(await read(w, "u-sofi"));
    expect(cells(matrix, "Home")).toEqual([
      ["member-ana", pesos(588_000), pesos(900_000), pesos(520_000), pesos(312_000), "OVER_CONTRIBUTED"],
      ["member-juan", pesos(882_000), pesos(400_000), pesos(780_000), -pesos(482_000), "UNDER_CONTRIBUTED"],
      ["member-sofi", 0n, 0n, 0n, 0n, "ON_TARGET"],
      ["member-pedro", 0n, 0n, 0n, 0n, "ON_TARGET"],
    ]);
  });

  it("counts a subcategory's payments and shares on the line its category consumes (HU-E3-04)", async () => {
    const w = await world();
    w.sums.byCategory[NOVEMBER] = [...novemberSums(), sum("cat-vegetables", "member-ana", 100_000, 50_000)];
    expect(cells(unwrap(await read(w)), "Home")[0]).toEqual([
      "member-ana",
      pesos(588_000),
      pesos(1_000_000),
      pesos(570_000),
      pesos(412_000),
      "OVER_CONTRIBUTED",
    ]);
  });

  it("reconciles with the line dashboard of the same world, two members' accounts credited to their owners", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines.map((l) =>
        l.name === "Savings"
          ? { ...l, savingsAccountIds: ["acc-savings", "acc-juan-savings", "acc-luis-savings"] }
          : l,
      ),
    });
    w.sums.byCategory[NOVEMBER] = [
      ...novemberSums(),
      sum("cat-vegetables", "member-ana", 100_000, 50_000),
      sum("cat-vegetables", "member-juan", 0, 50_000),
    ];
    // The same expenses as the ledger sums them per category, subcategory included, and the same transfers.
    w.spending.expenses[NOVEMBER] = [
      { categoryId: "cat-groceries", amount: pesos(900_000) },
      { categoryId: "cat-vegetables", amount: pesos(100_000) },
      { categoryId: "cat-utilities", amount: pesos(400_000) },
      { categoryId: "cat-rent", amount: pesos(1_200_000) },
      { categoryId: "cat-entertainment", amount: pesos(50_000) },
    ];
    w.spending.transfers[NOVEMBER] = [
      { accountId: "acc-savings", amount: pesos(300_000) },
      { accountId: "acc-juan-savings", amount: pesos(120_000) },
      { accountId: "acc-luis-savings", amount: pesos(50_000) },
    ];
    const matrix = unwrap(await read(w));
    const dashboard = unwrap(
      await createGetLineDashboard(w.deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" }),
    );
    expect(cells(matrix, "Savings").map((c) => [c[0], c[2]])).toEqual([
      ["member-ana", pesos(300_000)],
      ["member-juan", pesos(120_000)],
    ]);
    const total = (values: readonly (bigint | null)[]) =>
      values.reduce<bigint>((acc, v) => acc + (v ?? 0n), 0n);
    for (const line of matrix.lines) {
      const spent = dashboard.lines.find((d) => d.name === line.name)!.spent;
      const column =
        line.funding === "SAVINGS"
          ? line.members.map((c) => c.contributed)
          : line.members.map((c) => c.consumed);
      expect([line.name, total(column)]).toEqual([line.name, spent]);
    }
  });

  it("has no lines and no member totals for a period without a plan", async () => {
    const matrix = unwrap(await read(await world(), "u-ana", "2027-01"));
    expect(matrix).toMatchObject({ plan: null, lines: [], members: [], period: { label: "2027-01" } });
  });
});

describe("each member's total gap (#213, ruling P262)", () => {
  it("adds Home's and Savings' gaps per member, leaving fund-level Rent and unallocated Free out", async () => {
    const matrix = unwrap(await read(await world()));
    expect(matrix.members).toEqual([
      { memberId: "member-ana", gap: pesos(72_000), status: "OVER_CONTRIBUTED" },
      { memberId: "member-juan", gap: -pesos(842_000), status: "UNDER_CONTRIBUTED" },
    ]);
  });

  it("lists every current member in join order, each line's rows unchanged, for VIEWER Sofi", async () => {
    const w = await world(BUDGET_MEMBERS);
    const matrix = unwrap(await read(w, "u-sofi"));
    expect(matrix.members.map((m) => [m.memberId, m.gap, m.status])).toEqual([
      ["member-ana", pesos(72_000), "OVER_CONTRIBUTED"],
      ["member-juan", -pesos(842_000), "UNDER_CONTRIBUTED"],
      ["member-sofi", 0n, "ON_TARGET"],
      ["member-pedro", 0n, "ON_TARGET"],
    ]);
    expect(cells(matrix, "Home")[0]).toEqual([
      "member-ana",
      pesos(588_000),
      pesos(900_000),
      pesos(520_000),
      pesos(312_000),
      "OVER_CONTRIBUTED",
    ]);
  });

  it("gives a member a null total while no line has a gap for them: Home's allocation does not hold", async () => {
    const w = reportingWorld({ members: ANA_AND_JUAN });
    const base = parts();
    await w.plan("2026-11", {
      ...base,
      lines: base.lines
        .filter((l) => l.name !== "Savings")
        .map((l) => (l.name === "Home" ? { ...l, allocationRule: "PERCENT" as const } : l)),
      allocations: [{ lineId: "line-home", memberId: "member-ana", value: 5_000n }],
    });
    w.sums.byCategory[NOVEMBER] = novemberSums();
    const matrix = unwrap(await read(w));
    expect(lineOf(matrix, "Home").reason).toBe("INVALID_ALLOCATION");
    expect(matrix.members).toEqual([
      { memberId: "member-ana", gap: null, status: null },
      { memberId: "member-juan", gap: null, status: null },
    ]);
  });
});
