import { describe, expect, it } from "vitest";
import {
  SPLIT_METHODS,
  type BudgetPlan,
  type BudgetLineId,
  type BudgetPlanId,
  type BudgetPlanView,
} from "@/modules/budgeting/application";
import { SplitBodySchema } from "@/modules/ledger/contracts/ledger.contract";
import { planFigures } from "@/modules/budgeting/domain/plan-figures";
import type { LocalDate } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  AddLineBodySchema,
  budgetPlanDto,
  CreatePlanBodySchema,
  lineFromBody,
  UpdateLineBodySchema,
  planCopied,
  planCreated,
  planSuccess,
} from "./budgeting.contract";

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
const plan: BudgetPlan = {
  id: "plan-november" as BudgetPlanId,
  spaceId: "space-household",
  period: { label: "2026-11", start: "2026-11-01" as LocalDate, end: "2026-11-30" as LocalDate },
  status: "DRAFT",
  createdFrom: null,
  version: 4,
  createdBy: "u-ana",
  createdAt: new Date("2026-10-14T12:00:00Z"),
};
const view = (
  lines = referenceLines(),
  byCategory = [{ categoryId: "cat-groceries", currency: "COP", amount: 90_000_000n }],
): BudgetPlanView => ({
  plan,
  currency: "COP",
  figures: planFigures({
    currency: "COP",
    memberIds: ["member-ana", "member-juan"],
    parts: {
      capacities: [
        { memberId: "member-ana", currency: "COP", amount: 160_000_000n },
        { memberId: "member-juan", currency: "COP", amount: 240_000_000n },
      ],
      lines,
      mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
      allocations: [
        { lineId: "line-free", memberId: "member-ana", currency: null, value: 4200n },
        { lineId: "line-free", memberId: "member-juan", currency: null, value: 5800n },
      ],
    },
    spending: { byCategory, byAccount: [] },
  }),
});

describe("BudgetPlan on the wire (HU-E6-01 … HU-E6-05)", () => {
  it("sends a line's payers and scope only when it has payers, so a line without them answers as before (D26)", () => {
    const lines = referenceLines().map((l) =>
      l.name === "Rent" ? { ...l, payerMemberIds: ["member-ana"], payersScope: "EVERY_PERIOD" as const } : l,
    );
    const dto = budgetPlanDto(view(lines));
    const home = dto.lines.find((l) => l.name === "Home")!;
    expect(home).not.toHaveProperty("payerMemberIds");
    expect(home).not.toHaveProperty("payersScope");
    expect(dto.lines.find((l) => l.name === "Rent")).toMatchObject({
      payerMemberIds: ["member-ana"],
      payersScope: "EVERY_PERIOD",
    });
  });

  it("prints the reference plan with two-decimal percentages and money as minor-unit strings (golden)", () => {
    const lines = referenceLines().map((l) =>
      l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l,
    );
    const dto = budgetPlanDto(view(lines));
    expect(dto).toMatchObject({
      id: "plan-november",
      spaceId: "space-household",
      period: { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 4,
      capacities: [
        { memberId: "member-ana", amount: cop(1_600_000), share: "40.00" },
        { memberId: "member-juan", amount: cop(2_400_000), share: "60.00" },
      ],
      totalCapacity: cop(4_000_000),
      planned: cop(4_000_000),
      unallocated: cop(0),
      unbudgeted: null,
    });
    expect(dto.lines.map((l) => l.capacityShare)).toEqual(["30.00", "36.75", "15.00", "18.25"]);
    const home = dto.lines.find((l) => l.name === "Home")!;
    expect(home).toEqual({
      id: "line-home",
      originLineId: null,
      name: "Home",
      plannedAmount: cop(1_470_000),
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
      categoryIds: ["cat-groceries"],
      capacityShare: "36.75",
      allocation: {
        rule: "PROPORTIONAL",
        members: [
          { memberId: "member-ana", percent: null, amount: null, assigned: cop(588_000) },
          { memberId: "member-juan", percent: null, amount: null, assigned: cop(882_000) },
        ],
        error: null,
      },
      spent: cop(900_000),
      carryOver: cop(0),
      carryOverFrom: null,
      available: cop(570_000),
      // Ruling P342 (S7): a single-currency line lists its one budget, with exactly the scalar figures.
      budgets: [
        {
          planned: cop(1_470_000),
          budgeted: true,
          capacityShare: "36.75",
          allocation: {
            members: [
              { memberId: "member-ana", amount: null, assigned: cop(588_000) },
              { memberId: "member-juan", amount: null, assigned: cop(882_000) },
            ],
            error: null,
          },
          spent: cop(900_000),
          carryOver: cop(0),
          available: cop(570_000),
        },
      ],
    });
    expect(dto.currencies).toEqual([
      {
        capacities: [
          { memberId: "member-ana", amount: cop(1_600_000), share: "40.00" },
          { memberId: "member-juan", amount: cop(2_400_000), share: "60.00" },
        ],
        totalCapacity: cop(4_000_000),
        planned: cop(4_000_000),
        unallocated: cop(0),
        unbudgeted: null,
      },
    ]);
    expect(dto.lines.find((l) => l.name === "Free")!.allocation.members).toEqual([
      { memberId: "member-ana", percent: "42.00", amount: null, assigned: cop(306_600) },
      { memberId: "member-juan", percent: "58.00", amount: null, assigned: cop(423_400) },
    ]);
  });

  it("prints where a carry-over comes from: the source plan, its period and whether it is closed (ruling P243 of M6c)", () => {
    const lines = referenceLines().map((l) =>
      l.name === "Home"
        ? { ...l, originLineId: "line-home-nov" as BudgetLineId, rolloverMode: "ROLLOVER" as const }
        : l,
    );
    const source = { label: "2026-10", start: "2026-10-01" as LocalDate, end: "2026-10-31" as LocalDate };
    const { figures } = view(lines);
    const withSource = planFigures({
      currency: "COP",
      memberIds: ["member-ana", "member-juan"],
      parts: {
        capacities: figures.capacities.map((c) => ({
          memberId: c.memberId,
          currency: "COP",
          amount: c.amount,
        })),
        lines,
        mappings: [],
        allocations: [],
      },
      spending: { byCategory: [], byAccount: [] },
      source: { planId: "plan-october", period: source, closed: false, lineIds: ["line-home-nov"] },
    });
    const dto = budgetPlanDto({ plan, currency: "COP", figures: withSource });
    expect(dto.lines.find((l) => l.name === "Home")!.carryOverFrom).toEqual({
      planId: "plan-october",
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
      closed: false,
    });
    expect(dto.lines.filter((l) => l.name !== "Home").map((l) => l.carryOverFrom)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("prints FIXED amounts, flags an invalid allocation and lists nobody on NONE", () => {
    const lines = referenceLines().map((l) =>
      l.name === "Free"
        ? { ...l, allocationRule: "FIXED" as const }
        : l.name === "Rent"
          ? { ...l, allocationRule: "NONE" as const }
          : l,
    );
    const dto = budgetPlanDto(view(lines));
    expect(dto.lines.find((l) => l.name === "Free")!.allocation).toEqual({
      rule: "FIXED",
      members: [
        {
          memberId: "member-ana",
          percent: null,
          amount: { amount: "4200", currency: "COP" },
          assigned: null,
        },
        {
          memberId: "member-juan",
          percent: null,
          amount: { amount: "5800", currency: "COP" },
          assigned: null,
        },
      ],
      error: "InvalidAllocation",
    });
    expect(dto.lines.find((l) => l.name === "Rent")!.allocation).toEqual({
      rule: "NONE",
      members: [],
      error: null,
    });
  });

  it("reports unmapped spending as unbudgeted when no line is a catch-all", () => {
    const lines = referenceLines().map((l) => ({ ...l, isCatchAll: false }));
    const dto = budgetPlanDto(
      view(lines, [{ categoryId: "cat-travel", currency: "COP", amount: 25_000_000n }]),
    );
    expect(dto.unbudgeted).toEqual({ spent: cop(250_000), available: cop(-250_000) });
  });

  it("answers with the version as ETag, and the location on creation", () => {
    expect(planSuccess(view()).headers).toEqual([["etag", '"4"']]);
    expect(planSuccess(view(), 201).status).toBe(201);
    expect(planCreated(view())).toMatchObject({
      status: 201,
      headers: [
        ["etag", '"4"'],
        ["location", "/api/v1/spaces/space-household/plans/plan-november"],
      ],
    });
  });

  it("prints a copy's line origins and what it left out (HU-E6-06)", () => {
    const lines = referenceLines().map((l) => ({ ...l, originLineId: `nov-${l.id}` }));
    const dropped = {
      mappings: [{ lineId: "line-home", categoryId: "cat-utilities" }],
      savingsAccounts: [{ lineId: "line-savings", accountId: "acc-juan-savings" }],
      lines: [{ originLineId: "nov-line-trip", name: "Trip" }],
    };
    const copied = planCopied({ view: view(lines), dropped });
    expect(copied).toMatchObject({
      status: 201,
      headers: [
        ["etag", '"4"'],
        ["location", "/api/v1/spaces/space-household/plans/plan-november"],
      ],
    });
    const body = copied.body as ReturnType<typeof budgetPlanDto>;
    expect(body.lines.map((l) => l.originLineId)).toEqual([
      "nov-line-rent",
      "nov-line-home",
      "nov-line-savings",
      "nov-line-free",
    ]);
    expect(body.dropped).toEqual(dropped);
  });

  it("leaves dropped out, not null, of every other answer, and prints originLineId null on lines not copied", () => {
    for (const body of [budgetPlanDto(view()), planCreated(view()).body, planSuccess(view()).body]) {
      expect(body).not.toHaveProperty("dropped");
      expect((body as ReturnType<typeof budgetPlanDto>).lines.map((l) => l.originLineId)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    }
    const empty = planCopied({ view: view(), dropped: { mappings: [], savingsAccounts: [], lines: [] } });
    expect(empty.body).toHaveProperty("dropped", { mappings: [], savingsAccounts: [], lines: [] });
  });

  it("takes copyFrom: previous, and nothing else, on POST …/plans", () => {
    expect(CreatePlanBodySchema.safeParse({ period: "2026-12", copyFrom: "previous" }).success).toBe(true);
    expect(CreatePlanBodySchema.safeParse({ period: "2026-12" }).success).toBe(true);
    for (const copyFrom of ["template", "Previous", "", 1, true, null, ["previous"], { from: "previous" }]) {
      expect(CreatePlanBodySchema.safeParse({ period: "2026-12", copyFrom }).success).toBe(false);
    }
  });
});

describe("a plan per currency on the wire (ruling P342, S7)", () => {
  const usd = (dollars: number) => ({ amount: String(dollars * 100), currency: "USD" });

  it("prints Salidas' COP and USD budgets apart, and the plan's Por repartir per currency", () => {
    const lines = [
      ...referenceLines().filter((l) => l.name !== "Free"),
      {
        ...referenceLines().find((l) => l.name === "Free")!,
        budgets: [
          { currency: "COP", amount: 73_000_000n },
          { currency: "USD", amount: 10_000n },
        ],
      },
    ];
    const { figures } = view(lines, [
      { categoryId: "cat-groceries", currency: "COP", amount: 90_000_000n },
      { categoryId: "cat-unmapped", currency: "USD", amount: 4_500n },
    ]);
    const dto = budgetPlanDto({ plan, currency: "COP", figures });
    const free = dto.lines.find((l) => l.name === "Free")!;
    expect(free.plannedAmount).toEqual(cop(730_000));
    expect(free.budgets!.map((b) => [b.planned, b.spent, b.available, b.allocation.error])).toEqual([
      [cop(730_000), cop(0), cop(730_000), null],
      // Nobody contributes USD, so the USD budget cannot be shared by capacity.
      [usd(100), usd(45), usd(55), "InvalidAllocation"],
    ]);
    expect(free.allocation.error).toBe("InvalidAllocation");
    expect(dto.currencies!.map((c) => [c.totalCapacity, c.planned, c.unallocated])).toEqual([
      [cop(4_000_000), cop(4_000_000), cop(0)],
      [usd(0), usd(100), usd(-100)],
    ]);
  });

  it("takes a line's budgets or one plannedAmount, never both and never neither", () => {
    const base = { name: "Salidas" };
    expect(AddLineBodySchema.safeParse({ ...base, budgets: [cop(300_000), usd(100)] }).success).toBe(true);
    expect(AddLineBodySchema.safeParse({ ...base, plannedAmount: cop(300_000) }).success).toBe(true);
    expect(AddLineBodySchema.safeParse(base).success).toBe(false);
    expect(AddLineBodySchema.safeParse({ ...base, plannedAmount: cop(1), budgets: [cop(1)] }).success).toBe(
      false,
    );
    expect(AddLineBodySchema.safeParse({ ...base, budgets: [] }).success).toBe(false);
    expect(UpdateLineBodySchema.safeParse({ budgets: [usd(80)] }).success).toBe(true);
    expect(UpdateLineBodySchema.safeParse({ plannedAmount: cop(1), budgets: [cop(1)] }).success).toBe(false);
    const parsed = lineFromBody(AddLineBodySchema.parse({ ...base, budgets: [cop(300_000), usd(100)] }));
    expect(parsed.ok && parsed.value.budgets.map((m) => [m.minor, m.currency.code])).toEqual([
      [30_000_000n, "COP"],
      [10_000n, "USD"],
    ]);
  });
});

describe("the default split's methods (HU-E6-08)", () => {
  it("offers, besides BY_ALLOCATION, exactly the methods the ledger accepts in a split", () => {
    // The module boundary keeps budgeting from importing the ledger, so SPLIT_METHODS mirrors its list: a method
    // the ledger gained would silently be missing from the preview's availableMethods.
    const ledgerMethods = SplitBodySchema.options.map((option) => option.shape.method.value);
    expect(SPLIT_METHODS.filter((method) => method !== "BY_ALLOCATION")).toEqual(ledgerMethods);
  });
});
