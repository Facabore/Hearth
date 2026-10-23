import { describe, expect, it } from "vitest";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { ifMatch, planWrite, rereadPlan } from "./plan-write";

const path = { spaceId: "sp-household", planId: "p-nov" };
const ACTIVATE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/activate";

describe("plan writes (ruling P206)", () => {
  it("sends the version it shows and keeps the plan the API answers", async () => {
    const answered = referencePlanDto({ status: "ACTIVE", version: 8 });
    const { api, requests } = fakeApi({ [ACTIVATE]: () => jsonResponse(answered) });
    const result = await planWrite(
      api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", {
        params: { path },
        headers: ifMatch(referencePlanDto()),
      }),
    );
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(result).toEqual({ ok: true, plan: answered });
  });

  it("keeps the lines an InvalidAllocation names, and turns a failed fetch into Unknown", async () => {
    const invalid = fakeApi({
      [ACTIVATE]: () => problemResponse(422, "InvalidAllocation", { lineIds: ["l-free"] }),
    });
    const refused = await planWrite(
      invalid.api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", { params: { path } }),
    );
    expect(refused).toMatchObject({
      ok: false,
      problem: { code: "InvalidAllocation", status: 422 },
      lineIds: ["l-free"],
    });
    const offline = fakeApi({
      [ACTIVATE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(
      await planWrite(
        offline.api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", { params: { path } }),
      ),
    ).toEqual({
      ok: false,
      problem: { code: "Unknown", status: 0, requestId: null, errors: [], field: null },
      lineIds: [],
    });
  });

  it("re-reads the plan after a 412, and answers null when it cannot", async () => {
    const fresh = referencePlanDto({ version: 9 });
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(fresh) });
    expect(await rereadPlan(api, "sp-household", "p-nov")).toEqual(fresh);
    const gone = fakeApi({
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => problemResponse(404, "BudgetPlanNotFound"),
    });
    expect(await rereadPlan(gone.api, "sp-household", "p-nov")).toBeNull();
  });
});
