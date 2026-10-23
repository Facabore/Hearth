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
    expect(
      await saveLine(
        api,
        { spaceId: "sp-household", plan, lineId: null },
        { line: pets, categoryIds: null, allocation: null },
      ),
    ).toEqual({
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
    expect(
      await saveLine(
        api,
        { spaceId: "sp-household", plan, lineId: "l-home" },
        { line: {}, categoryIds: null, allocation: null },
      ),
    ).toEqual({
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
      { line: { name: "Rent" }, categoryIds: null, allocation: null },
    );
    expect(outcome).toMatchObject({
      ok: false,
      plan,
      section: "line",
      problem: { code: "BudgetLineNameTaken" },
    });
  });

  it("maps the categories and allocates after the line, each with the version the step before answered", async () => {
    let version = 7;
    const next = () => jsonResponse(referencePlanDto({ version: ++version }));
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": next,
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories": next,
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": next,
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: "l-home" },
      { line: { name: "Casa" }, categoryIds: ["c-groceries", "c-utilities"], allocation: { rule: "NONE" } },
    );
    expect(outcome).toMatchObject({ ok: true, lineId: "l-home", plan: { version: 10 } });
    expect(requests.map((r) => [r.method, r.headers.get("if-match")])).toEqual([
      ["PATCH", '"7"'],
      ["PUT", '"8"'],
      ["PUT", '"9"'],
    ]);
    expect(await requests[1]!.json()).toEqual({ categoryIds: ["c-groceries", "c-utilities"] });
  });

  it("stops at a refused allocation and keeps the plan the line step answered", async () => {
    const patched = referencePlanDto({ version: 8 });
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () => jsonResponse(patched),
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () =>
        problemResponse(422, "InvalidAllocation"),
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: "l-home" },
      { line: { name: "Casa" }, categoryIds: null, allocation: { rule: "NONE" } },
    );
    expect(outcome).toMatchObject({
      ok: false,
      plan: patched,
      section: "allocation",
      problem: { code: "InvalidAllocation" },
    });
  });

  it("names the line an add created when the step after it is refused, so a retry does not add it twice", async () => {
    const added = referencePlanDto({
      version: 8,
      lines: [...plan.lines, planLineDto({ id: "l-pets", name: "Pets" })],
    });
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines": () => jsonResponse(added, 201),
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories": () =>
        problemResponse(409, "CategoryAlreadyMapped"),
    });
    const outcome = await saveLine(
      api,
      { spaceId: "sp-household", plan, lineId: null },
      { line: pets, categoryIds: ["c-groceries"], allocation: { rule: "NONE" } },
    );
    expect(outcome).toMatchObject({
      ok: false,
      plan: added,
      section: "categories",
      lineId: "l-pets",
      problem: { code: "CategoryAlreadyMapped" },
    });
    expect(requests.map((r) => r.method)).toEqual(["POST", "PUT"]);
    expect(new URL(requests[1]!.url).pathname).toBe(
      "/api/v1/spaces/sp-household/plans/p-nov/lines/l-pets/categories",
    );
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
