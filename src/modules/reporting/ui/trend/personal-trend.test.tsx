import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { NOVEMBER, sixMonthsTrend } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadPersonalTrend, windowOf } from "./personal-trend-container";
import { PersonalTrend } from "./personal-trend";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("personal trend (HU-E9-11)", () => {
  // The first load of the lazy Recharts chunk is slow on a cold transform cache, as in CI.
  it(
    "draws 6 points from 2026-06 to 2026-11 and lists the same figures in its table",
    { timeout: 60_000 },
    async () => {
      const { container } = renderWithIntl(
        <PersonalTrend space={spaceDto()} trend={sixMonthsTrend()} formats={BUILT_IN_FORMATS} periods={6} />,
      );
      expect(screen.getByRole("figure", { name: "Mi consumo por período" })).toBeInTheDocument();
      expect(await screen.findByTestId("trend-chart", {}, { timeout: 45_000 })).toHaveAttribute(
        "data-points",
        "6",
      );
      const rows = within(screen.getByRole("table", { name: "Consumo por período" }))
        .getAllByRole("row")
        .slice(1)
        .map((row) => normalized(row.textContent));
      expect(rows).toHaveLength(6);
      expect(rows[0]).toContain("noviembre 2026");
      expect(rows[0]).toContain("$ 1.575.000");
      expect(rows[0]).toContain("+$ 75.000 (+5,00 %)");
      expect(rows[2]).toContain("−$ 150.000 (−10,34 %)");
      expect(rows[5]).toContain("junio 2026");
      expect(rows[5]).toContain("Nueva");
      expect(screen.getByRole("link", { name: "12 períodos" })).toHaveAttribute(
        "href",
        "/spaces/sp-personal/plan/trend?period=2026-11&periods=12",
      );
      expect(await axeViolations(container)).toEqual([]);
    },
  );

  it("asks for the chosen window ending in the period", async () => {
    expect([windowOf(undefined), windowOf("12"), windowOf("7")]).toEqual([6, 12, 6]);
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/trend": () => jsonResponse(sixMonthsTrend()),
    });
    await loadPersonalTrend(api, { spaceId: "sp-personal", periods: 12, today: "2026-11-15" });
    const query = new URL(requests.find((r) => r.url.includes("/me/trend"))!.url).searchParams;
    expect([query.get("endPeriod"), query.get("periods")]).toEqual(["2026-11", "12"]);
  });
});
