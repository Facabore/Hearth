import { describe, expect, it } from "vitest";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { checkedAllocation } from "./allocation";
import { newLine, reviseLine, type BudgetLine, type BudgetLineId, type LineContext } from "./budget-line";
import { copiedParts } from "./plan-copy";
import { activationCheck, planFigures, type PlanParts, type PeriodSpending } from "./plan-figures";

/**
 * Ruling P342 (S7, owner: "Líneas por moneda", "Misma regla, por moneda"), on the approved boards of
 * docs/design/2026-11-18-plan-per-currency: Ana 1.600.000 COP, Juan 2.400.000 COP and 100 USD; Salidas plans 300.000
 * COP and 100 USD. Nothing is ever converted.
 */
const ANA = "member-ana";
const JUAN = "member-juan";
const pesos = (n: number) => BigInt(n) * 100n;
const usd = (n: number) => BigInt(n) * 100n;
const COP = (amount: bigint) => ({ currency: "COP", amount });
const USD = (amount: bigint) => ({ currency: "USD", amount });
const now = new Date("2026-11-18T12:00:00Z");

const capacities = [
  { memberId: ANA, currency: "COP", amount: pesos(1_600_000) },
  { memberId: JUAN, currency: "COP", amount: pesos(2_400_000) },
  { memberId: JUAN, currency: "USD", amount: usd(100) },
];
const salidas = (overrides: Partial<BudgetLine> = {}) =>
  aLine("Salidas", 0n, { budgets: [COP(pesos(300_000)), USD(usd(100))], ...overrides });
const arriendo = () => aLine("Arriendo", pesos(3_700_000));
const parts = (overrides: Partial<PlanParts> = {}): PlanParts => ({
  capacities,
  lines: [arriendo(), salidas()],
  mappings: [{ lineId: "line-salidas", categoryId: "cat-salidas" }],
  allocations: [],
  ...overrides,
});
const spending = (rows: PeriodSpending["byCategory"] = []): PeriodSpending => ({
  byCategory: rows,
  byAccount: [],
});
const figures = (p: PlanParts, s: PeriodSpending = spending(), previousAvailable = []) =>
  planFigures({ currency: "COP", memberIds: [ANA, JUAN], parts: p, spending: s, previousAvailable });
const context = (siblings: readonly BudgetLine[]): LineContext => ({
  siblings,
  totalCapacities: [COP(pesos(4_000_000)), USD(usd(100))],
  mappedCategories: 0,
  payerCandidateIds: [],
});
const fields = (budgets: { currency: string; amount: bigint }[]) => ({
  name: "Salidas",
  budgets,
  funding: "DIRECT" as const,
  savingsAccountIds: [],
  rolloverMode: "RESET" as const,
  isCatchAll: false,
  payerMemberIds: [],
  payersScope: null,
});
const add = (
  budgets: { currency: string; amount: bigint }[],
  siblings: readonly BudgetLine[] = [arriendo()],
) =>
  newLine(
    { id: "line-salidas" as BudgetLineId, planId: "plan-november", now, fields: fields(budgets) },
    context(siblings),
  );

describe("a line's budgets per currency (S7)", () => {
  it("adds Salidas with 300.000 COP and 100 USD, each fitting the capacity in its own currency", () => {
    expect(unwrap(add([COP(pesos(300_000)), USD(usd(100))])).budgets).toEqual([
      COP(pesos(300_000)),
      USD(usd(100)),
    ]);
  });

  it("checks each budget against its own currency's capacity, naming the currency that does not fit", () => {
    expect(add([COP(pesos(300_000)), USD(usd(101))])).toEqual({
      ok: false,
      error: { code: "PlanExceedsCapacity", details: { currency: "USD" } },
    });
    // A budget in a currency nobody contributes never fits, and nothing converts it into COP.
    expect(codeOf(add([COP(pesos(300_000)), { currency: "EUR", amount: 1n }]))).toBe("PlanExceedsCapacity");
  });

  it("refuses a line without budgets, a budget that is not positive and two budgets in one currency", () => {
    expect(add([])).toEqual({
      ok: false,
      error: { code: "InvalidPlannedAmount", details: { reason: "noBudget" } },
    });
    expect(codeOf(add([COP(pesos(300_000)), USD(0n)]))).toBe("InvalidPlannedAmount");
    expect(add([USD(usd(50)), USD(usd(50))])).toEqual({
      ok: false,
      error: { code: "InvalidPlannedAmount", details: { reason: "duplicateCurrency" } },
    });
  });

  it("checks a growing line per currency: raising USD past its capacity is refused even while COP shrinks", () => {
    const line = salidas();
    const grow = reviseLine(line, { budgets: [COP(pesos(100_000)), USD(usd(120))] }, context([arriendo()]));
    expect(grow).toEqual({ ok: false, error: { code: "PlanExceedsCapacity", details: { currency: "USD" } } });
    // Lowering one currency and keeping the other never needs a check, even over a capacity reduced below the lines.
    const reduced = { ...context([arriendo()]), totalCapacities: [COP(pesos(100))] };
    expect(
      unwrap(reviseLine(line, { budgets: [COP(pesos(200_000)), USD(usd(100))] }, reduced)).budgets,
    ).toEqual([COP(pesos(200_000)), USD(usd(100))]);
  });
});

describe("plan figures per currency (S7)", () => {
  it("counts a movement only against the budget in its own currency, and never converts", () => {
    const f = figures(
      parts(),
      spending([
        { categoryId: "cat-salidas", currency: "COP", amount: pesos(340_000) },
        { categoryId: "cat-salidas", currency: "USD", amount: usd(45) },
      ]),
    );
    const line = f.lines.find((l) => l.line.name === "Salidas")!;
    expect(line.budgets.map((b) => [b.currency, b.planned, b.spent, b.available])).toEqual([
      ["COP", pesos(300_000), pesos(340_000), -pesos(40_000)],
      ["USD", usd(100), usd(45), usd(55)],
    ]);
    // The scalar figures stay the space currency's, as before T6.
    expect([line.planned, line.spent, line.available]).toEqual([
      pesos(300_000),
      pesos(340_000),
      -pesos(40_000),
    ]);
  });

  it("reports spending in a currency the line does not budget as spent without a budget, never dropped", () => {
    const f = figures(parts(), spending([{ categoryId: "cat-salidas", currency: "EUR", amount: 2_000n }]));
    const line = f.lines.find((l) => l.line.name === "Salidas")!;
    expect(line.budgets.map((b) => [b.currency, b.budgeted, b.planned, b.spent, b.available])).toEqual([
      ["COP", true, pesos(300_000), 0n, pesos(300_000)],
      ["USD", true, usd(100), 0n, usd(100)],
      ["EUR", false, 0n, 2_000n, -2_000n],
    ]);
    expect(line.allocation.invalid).toBe(false);
  });

  it("totals capacity, planned and Por repartir per currency, the space currency first", () => {
    const f = figures(parts());
    expect(f.currencies.map((c) => [c.currency, c.totalCapacity, c.planned, c.unallocated])).toEqual([
      ["COP", pesos(4_000_000), pesos(4_000_000), 0n],
      ["USD", usd(100), usd(100), 0n],
    ]);
    expect(f.currencies[1]!.capacities).toEqual([
      { memberId: ANA, amount: 0n, shareBasisPoints: 0 },
      { memberId: JUAN, amount: usd(100), shareBasisPoints: 10_000 },
    ]);
    expect(codeOf(activationCheck(f))).toBe("ok");
  });

  it("refuses activation when any currency's Por repartir is below 0, naming it", () => {
    const short = capacities.map((c) => (c.currency === "USD" ? { ...c, amount: usd(99) } : c));
    expect(activationCheck(figures(parts({ capacities: short })))).toEqual({
      ok: false,
      error: { code: "PlanExceedsCapacity", details: { currency: "USD" } },
    });
  });
});

describe("the line's rule per currency ('Misma regla, por moneda')", () => {
  const assigned = (p: PlanParts, currency: string) =>
    figures(p)
      .lines.find((l) => l.line.name === "Salidas")!
      .budgets.find((b) => b.currency === currency)!.allocation;

  it("PROPORTIONAL follows each member's contribution in that currency", () => {
    expect(assigned(parts(), "COP").members.map((m) => m.assigned)).toEqual([pesos(120_000), pesos(180_000)]);
    expect(assigned(parts(), "USD").members.map((m) => m.assigned)).toEqual([0n, usd(100)]);
  });

  it("PERCENT applies the same share to every currency", () => {
    const p = parts({
      lines: [arriendo(), salidas({ allocationRule: "PERCENT" })],
      allocations: [
        { lineId: "line-salidas", memberId: ANA, currency: null, value: 5000n },
        { lineId: "line-salidas", memberId: JUAN, currency: null, value: 5000n },
      ],
    });
    expect(assigned(p, "COP").members.map((m) => m.assigned)).toEqual([pesos(150_000), pesos(150_000)]);
    expect(assigned(p, "USD").members.map((m) => m.assigned)).toEqual([usd(50), usd(50)]);
  });

  it("FIXED takes the values typed per currency, and a currency whose values do not add up flags the line", () => {
    const fixed = (usdOfJuan: bigint): PlanParts =>
      parts({
        lines: [arriendo(), salidas({ allocationRule: "FIXED" })],
        allocations: [
          { lineId: "line-salidas", memberId: ANA, currency: "COP", value: pesos(100_000) },
          { lineId: "line-salidas", memberId: JUAN, currency: "COP", value: pesos(200_000) },
          { lineId: "line-salidas", memberId: JUAN, currency: "USD", value: usdOfJuan },
        ],
      });
    expect(assigned(fixed(usd(100)), "COP").members.map((m) => [m.value, m.assigned])).toEqual([
      [pesos(100_000), pesos(100_000)],
      [pesos(200_000), pesos(200_000)],
    ]);
    expect(assigned(fixed(usd(100)), "USD").members.map((m) => m.assigned)).toEqual([0n, usd(100)]);
    const short = figures(fixed(usd(90)));
    expect(short.lines.find((l) => l.line.name === "Salidas")!.allocation.invalid).toBe(true);
    expect(activationCheck(short)).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-salidas"] } },
    });
  });

  it("checks FIXED values per currency: each budget adds up, and only the line's own currencies are typed", () => {
    const line = salidas();
    const members = [ANA, JUAN];
    const ok = checkedAllocation(
      {
        rule: "FIXED",
        members: [
          { memberId: JUAN, amount: money(usd(100), "USD") },
          { memberId: ANA, amount: money(pesos(100_000)) },
          { memberId: JUAN, amount: money(pesos(200_000)) },
        ],
      },
      line,
      members,
      [],
    );
    // Join order, then the line's currency order.
    expect(unwrap(ok).values).toEqual([
      { memberId: ANA, currency: "COP", value: pesos(100_000) },
      { memberId: JUAN, currency: "COP", value: pesos(200_000) },
      { memberId: JUAN, currency: "USD", value: usd(100) },
    ]);
    const missingUsd = checkedAllocation(
      { rule: "FIXED", members: [{ memberId: ANA, amount: money(pesos(300_000)) }] },
      line,
      members,
      [],
    );
    expect(missingUsd).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "fixedNotPlanned", currency: "USD" } },
    });
    const euros = checkedAllocation(
      { rule: "FIXED", members: [{ memberId: ANA, amount: money(1n, "EUR") }] },
      line,
      members,
      [],
    );
    expect(euros).toEqual({
      ok: false,
      error: { code: "CurrencyMismatch", details: { expected: "COP,USD", actual: "EUR" } },
    });
    const twice = checkedAllocation(
      {
        rule: "FIXED",
        members: [
          { memberId: ANA, amount: money(usd(50), "USD") },
          { memberId: ANA, amount: money(usd(50), "USD") },
        ],
      },
      line,
      members,
      [],
    );
    expect(twice).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { reason: "duplicateMember" } },
    });
  });
});

describe("carry-over per currency (HU-E6-09, S7)", () => {
  it("applies the line's rollover mode to each currency's available on its own", () => {
    const previous = [{ lineId: "line-salidas-nov", available: [COP(-pesos(40_000)), USD(usd(55))] }];
    const copy = (rolloverMode: BudgetLine["rolloverMode"]) =>
      parts({ lines: [arriendo(), salidas({ originLineId: "line-salidas-nov", rolloverMode })] });
    const carried = (rolloverMode: BudgetLine["rolloverMode"]) =>
      planFigures({
        currency: "COP",
        memberIds: [ANA, JUAN],
        parts: copy(rolloverMode),
        spending: spending(),
        previousAvailable: previous,
      })
        .lines.find((l) => l.line.name === "Salidas")!
        .budgets.map((b) => [b.currency, b.carryOver, b.available]);
    expect(carried("ROLLOVER")).toEqual([
      ["COP", 0n, pesos(300_000)],
      ["USD", usd(55), usd(155)],
    ]);
    expect(carried("ADJUSTED")).toEqual([
      ["COP", -pesos(40_000), pesos(260_000)],
      ["USD", 0n, usd(100)],
    ]);
    expect(carried("RESET")).toEqual([
      ["COP", 0n, pesos(300_000)],
      ["USD", 0n, usd(100)],
    ]);
  });
});

describe("a plan copy per currency (HU-E6-06, S7)", () => {
  it("copies every budget, every capacity and every FIXED value in its own currency", () => {
    const source = parts({
      lines: [salidas({ allocationRule: "FIXED" })],
      allocations: [
        { lineId: "line-salidas", memberId: ANA, currency: "COP", value: pesos(300_000) },
        { lineId: "line-salidas", memberId: JUAN, currency: "USD", value: usd(100) },
      ],
    });
    const { parts: copied } = copiedParts({
      planId: "plan-december",
      now,
      source,
      lineIds: ["copy-salidas" as BudgetLineId],
      memberIds: [ANA, JUAN],
      viewerIds: [],
      categories: [{ id: "cat-salidas", archived: false }],
      usableAccountIds: [],
    });
    expect(copied.lines[0]!.budgets).toEqual([COP(pesos(300_000)), USD(usd(100))]);
    expect(copied.capacities).toEqual(capacities);
    expect(copied.allocations).toEqual([
      { lineId: "copy-salidas", memberId: ANA, currency: "COP", value: pesos(300_000) },
      { lineId: "copy-salidas", memberId: JUAN, currency: "USD", value: usd(100) },
    ]);
  });
});
