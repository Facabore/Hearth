import { describe, expect, it, vi } from "vitest";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { neighboursOf, periodLabel } from "./report-period";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const december = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };

describe("the period of a dashboard (ruling P205)", () => {
  it("asks for the period holding today only when no label is given", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
    });
    expect(await periodLabel(api, "sp-household", undefined, "2026-10-31")).toEqual({
      ok: true,
      data: "2026-10",
    });
    expect([...new URL(requests[0]!.url).searchParams]).toEqual([
      ["from", "2026-10-31"],
      ["count", "1"],
    ]);
    expect(await periodLabel(api, "sp-household", "2026-11", "2026-10-31")).toEqual({
      ok: true,
      data: "2026-11",
    });
    expect(requests).toHaveLength(1);
  });

  it("finds the neighbours from the day before the start and the day after the end", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": (request) =>
        jsonResponse({
          items: [new URL(request.url).searchParams.get("from") === "2026-10-31" ? october : december],
        }),
    });
    expect(await neighboursOf(api, "sp-household", november)).toEqual({ previous: october, next: december });
    expect(requests.map((r) => new URL(r.url).searchParams.get("from")).sort()).toEqual([
      "2026-10-31",
      "2026-12-01",
    ]);
  });
});
