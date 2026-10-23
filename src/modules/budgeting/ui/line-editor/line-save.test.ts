import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { planLineDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { newLineId, removeLine, saveLine } from "./line-save";

const plan = referencePlanDto();
const pets = {
  name: "Pets",
  plannedAmount: cop(80_000),
  funding: "DIRECT" as const,
  rolloverMode: "RESET" as const,
  isCatchAll: false,
  savingsAccountIds: [],
};

describe("saving a line (ruling P210)", () => {
  it("adds a line with the plan's version and finds the new line's id", async () => {
    const added = referencePlanDto({
      version: 8,
      lines: [...plan.lines, planLineDto({ id: "l-pets", name: "Pets" })],
    });
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines": () => jsonResponse(added, 201),
    });
    expect(await saveLine(api, { spaceId: "sp-household", plan, lineId: null }, { line: pets })).toEqual({
      ok: true,
      plan: added,
      lineId: "l-pets",
    });
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(await requests[0]!.json()).toEqual(pets);
  });

  it("finds the new line by what the plan did not have, wherever the answer lists it", () => {
    const after = referencePlanDto({ lines: [planLineDto({ id: "l-pets", name: "Pets" }), ...plan.lines] });
    expect(newLineId(plan, after)).toBe("l-pets");
  });

  it("sends nothing for an existing line without changes", async () => {
    const { api, requests } = fakeApi({});
    expect(await saveLine(api, { spaceId: "sp-household", plan, lineId: "l-home" }, { line: {} })).toEqual({
      ok: true,
      plan,
      lineId: "l-home",
    });
    expect(requests).toHaveLength(0);
  });

  it("stops at a refused line and keeps the plan it had", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        problemResponse(409, "BudgetLineNameTaken"),
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: "l-home" },
      { line: { name: "Rent" } },
    );
    expect(outcome).toMatchObject({
      ok: false,
      plan,
      section: "line",
      problem: { code: "BudgetLineNameTaken" },
    });
  });

  it("removes a line with the plan's version", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        jsonResponse(referencePlanDto({ version: 8, lines: plan.lines.slice(0, 3) })),
    });
    const result = await removeLine(api, { spaceId: "sp-household", plan, lineId: "l-free" });
    expect(result.ok && result.plan.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings"]);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/plans/p-nov/lines/l-free");
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
  });
});
