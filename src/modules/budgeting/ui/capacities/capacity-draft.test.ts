import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { HOUSEHOLD_MEMBERS, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { capacityBodyOf, capacityFieldOf, draftsOf, ownSuggestion } from "./capacity-draft";

const problem = (code: string, extra = {}) => ({
  code,
  status: 422,
  requestId: "r",
  errors: [],
  field: null,
  ...extra,
});

describe("capacity fields (HU-E9-08)", () => {
  it("starts each field from the stored capacity, in the person's number format", () => {
    expect(draftsOf(referencePlanDto(), HOUSEHOLD_MEMBERS, BUILT_IN_FORMATS)).toEqual({
      "m-ana": "1.600.000",
      "m-juan": "2.400.000",
    });
    expect(draftsOf(referencePlanDto({ capacities: [] }), HOUSEHOLD_MEMBERS, BUILT_IN_FORMATS)).toEqual({
      "m-ana": "",
      "m-juan": "",
    });
  });

  it("sends only the rows the viewer may change, an empty one as zero", () => {
    expect(
      capacityBodyOf({ "m-ana": "1.650.000", "m-juan": "" }, ["m-ana", "m-juan"], "COP", "DOT_COMMA"),
    ).toEqual({
      ok: true,
      body: {
        capacities: [
          { memberId: "m-ana", amount: { amount: "165000000", currency: "COP" } },
          { memberId: "m-juan", amount: { amount: "0", currency: "COP" } },
        ],
      },
    });
    expect(
      capacityBodyOf({ "m-ana": "1.600.000", "m-juan": "2.500.000" }, ["m-juan"], "COP", "DOT_COMMA"),
    ).toEqual({
      ok: true,
      body: { capacities: [{ memberId: "m-juan", amount: { amount: "250000000", currency: "COP" } }] },
    });
    expect(capacityBodyOf({ "m-ana": "dos" }, ["m-ana"], "COP", "DOT_COMMA")).toEqual({
      ok: false,
      memberId: "m-ana",
    });
  });

  it("points a validation path at its member's field and anything else at the form", () => {
    const sent = ["m-ana", "m-juan"];
    expect(
      capacityFieldOf(
        problem("ValidationFailed", { errors: [{ path: "capacities.1.amount", message: "x" }] }),
        sent,
      ),
    ).toBe("m-juan");
    expect(capacityFieldOf(problem("InvalidCapacity"), sent)).toBe("form");
  });
});

describe("the private suggestion (ruling P208, D17)", () => {
  const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
  const suggestion = (memberId: string) => ({ memberId, period: OCTOBER, suggested: cop(1_650_000) });
  const [ana, juan] = HOUSEHOLD_MEMBERS as [
    (typeof HOUSEHOLD_MEMBERS)[number],
    (typeof HOUSEHOLD_MEMBERS)[number],
  ];

  it("keeps a suggestion that names the viewer's own member", () => {
    expect(ownSuggestion(suggestion("m-ana"), ana)).toEqual(suggestion("m-ana"));
  });

  it("drops a suggestion of 0: no income last period suggests nothing (issue #175)", () => {
    expect(ownSuggestion({ ...suggestion("m-ana"), suggested: cop(0) }, ana)).toBeNull();
  });

  it("drops one that names anyone else, one with no amount, and one for a viewer with no member", () => {
    expect(ownSuggestion(suggestion("m-ana"), juan)).toBeNull();
    expect(ownSuggestion({ ...suggestion("m-ana"), suggested: null }, ana)).toBeNull();
    expect(ownSuggestion(suggestion("m-ana"), null)).toBeNull();
    expect(ownSuggestion(null, ana)).toBeNull();
  });
});
