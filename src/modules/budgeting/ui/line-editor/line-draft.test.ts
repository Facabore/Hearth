import { describe, expect, it } from "vitest";
import { planLineDto } from "../../../../../tests/support/ui/plan-dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { lineBodyOf, lineChanges, lineDraftOf, lineFieldOf, NEW_LINE } from "./line-draft";

const problem = (code: string, extra = {}) => ({
  code,
  status: 409,
  requestId: "r",
  errors: [],
  field: null,
  ...extra,
});

describe("line fields (HU-E9-08)", () => {
  it("starts a new line DIRECT, RESET and not catch-all, and an existing one from what it stores", () => {
    expect(lineDraftOf(null, BUILT_IN_FORMATS)).toEqual(NEW_LINE);
    expect(NEW_LINE).toEqual({
      name: "",
      planned: "",
      funding: "DIRECT",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
    });
    expect(lineDraftOf(planLineDto({ isCatchAll: true }), BUILT_IN_FORMATS)).toEqual({
      ...NEW_LINE,
      name: "Home",
      planned: "1.470.000",
      isCatchAll: true,
    });
  });

  it("builds the body of a line, a savings line never catch-all and any other without accounts", () => {
    expect(
      lineBodyOf(
        { ...NEW_LINE, name: " Rent ", planned: "1.200.000", funding: "SHARED_FUND" },
        "COP",
        "DOT_COMMA",
      ),
    ).toEqual({
      ok: true,
      body: {
        name: "Rent",
        plannedAmount: { amount: "120000000", currency: "COP" },
        funding: "SHARED_FUND",
        rolloverMode: "RESET",
        isCatchAll: false,
        savingsAccountIds: [],
      },
    });
    const savings = lineBodyOf(
      {
        ...NEW_LINE,
        name: "Savings",
        planned: "600.000",
        funding: "SAVINGS",
        isCatchAll: true,
        savingsAccountIds: ["a-savings"],
      },
      "COP",
      "DOT_COMMA",
    );
    expect(savings.ok && [savings.body.isCatchAll, savings.body.savingsAccountIds]).toEqual([
      false,
      ["a-savings"],
    ]);
    const direct = lineBodyOf(
      { ...NEW_LINE, name: "Home", planned: "1", savingsAccountIds: ["a-savings"] },
      "COP",
      "DOT_COMMA",
    );
    expect(direct.ok && direct.body.savingsAccountIds).toEqual([]);
    expect(lineBodyOf({ ...NEW_LINE, name: "Home", planned: "mucho" }, "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "planned",
    });
  });

  it("patches only what changed", () => {
    const home = planLineDto();
    const raised = lineBodyOf(
      { ...lineDraftOf(home, BUILT_IN_FORMATS), planned: "1.500.000" },
      "COP",
      "DOT_COMMA",
    );
    expect(raised.ok && lineChanges(home, raised.body)).toEqual({
      plannedAmount: { amount: "150000000", currency: "COP" },
    });
    const same = lineBodyOf(lineDraftOf(home, BUILT_IN_FORMATS), "COP", "DOT_COMMA");
    expect(same.ok && lineChanges(home, same.body)).toEqual({});
  });

  it("shows each API code next to its field and the rest above the button", () => {
    expect(lineFieldOf(problem("BudgetLineNameTaken"))).toBe("name");
    expect(lineFieldOf(problem("PlanExceedsCapacity"))).toBe("planned");
    expect(lineFieldOf(problem("SavingsAccountRequired"))).toBe("savings");
    expect(lineFieldOf(problem("CatchAllLineAlreadySet"))).toBe("catchAll");
    expect(
      lineFieldOf(problem("ValidationFailed", { errors: [{ path: "plannedAmount.amount", message: "x" }] })),
    ).toBe("planned");
    expect(lineFieldOf(problem("PeriodClosed"))).toBe("form");
  });
});
