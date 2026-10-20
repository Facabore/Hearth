import { describe, expect, it } from "vitest";
import { fakeApi, jsonResponse, problemResponse } from "./fake-api";

describe("fakeApi", () => {
  it("routes typed calls by method and path template and records the requests", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/accounts": (request, params) =>
        jsonResponse({
          items: [],
          totals: { available: { amount: "0", currency: "COP" }, netWorth: { amount: "0", currency: "COP" } },
          echo: params.spaceId,
        }),
      "POST /api/v1/auth/sign-in": () => problemResponse(401, "InvalidCredentials"),
    });
    const accounts = await api.GET("/api/v1/spaces/{spaceId}/accounts", {
      params: { path: { spaceId: "s1" }, query: { archived: "true" } },
    });
    expect(accounts.data).toMatchObject({ echo: "s1" });
    expect(new URL(requests[0]!.url).search).toBe("?archived=true");
    const signIn = await api.POST("/api/v1/auth/sign-in", {
      body: { email: "a@example.com", password: "x" },
    });
    expect(signIn.error).toMatchObject({ code: "InvalidCredentials" });
    await expect(api.GET("/api/v1/me")).rejects.toThrow("No fake route for GET /api/v1/me");
  });
});
