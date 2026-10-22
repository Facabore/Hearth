import { describe, expect, it, vi } from "vitest";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { loadLines } from "./lines-container";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("line dashboard container (HU-E9-10)", () => {
  it("loads today's period, its report and its neighbours", async () => {
    const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(e7Dashboard({ period: october, plan: null, lines: [] })),
    });
    const result = await loadLines(api, { spaceId: "sp-household", today: "2026-10-31" });
    expect(result.ok && result.data.dashboard.period).toEqual(october);
    const report = requests.find((r) => r.url.includes("/reports/lines"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-10");
  });
});
