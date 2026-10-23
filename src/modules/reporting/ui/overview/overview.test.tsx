import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  e7Fund,
  e7Groups,
  e7Matrix,
  homeTrend,
  HOUSEHOLD_MEMBERS,
  householdDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { DashOverview } from "./dash-overview";
import { loadOverview } from "./overview-container";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const overview = {
  matrix: e7Matrix(),
  fund: e7Fund(),
  groups: e7Groups(),
  trend: homeTrend(),
  members: HOUSEHOLD_MEMBERS,
};

describe("desktop overview (HU-E9-10, ruling P216)", () => {
  it("shows by group, the fund, the change against the previous period and the member matrix together", async () => {
    const { container } = renderWithIntl(
      <DashOverview space={householdDto()} overview={overview} formats={BUILT_IN_FORMATS} />,
    );
    expect(container.firstElementChild).toHaveClass("hidden", "lg:grid");
    const groups = normalized(screen.getByRole("region", { name: "Por grupo" }).textContent);
    expect(groups).toContain("Housing$ 1.600.000");
    expect(screen.getByRole("link", { name: "Ver por grupo" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/groups?period=2026-11",
    );
    expect(normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent)).toContain(
      "$ 980.000",
    );
    const change = normalized(screen.getByRole("region", { name: "Contra el período anterior" }).textContent);
    expect(change).toContain("−$ 50.000 (−3,70 %)");
    expect(change).toContain("Nueva");
    const matrix = screen.getByRole("table", { name: "Miembros por línea" });
    expect(within(matrix).getAllByRole("row")).toHaveLength(1 + 6);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads the overview in parallel for the period, and leaves out a panel whose read fails", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => problemResponse(500, "InternalError"),
      "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": () => jsonResponse(e7Groups()),
      "GET /api/v1/spaces/{spaceId}/reports/trend": () => jsonResponse(homeTrend()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    });
    const result = await loadOverview(api, { spaceId: "sp-household", period: "2026-11" });
    expect(result.fund).toBeNull();
    expect(result.matrix?.lines).toHaveLength(3);
    const trend = new URL(requests.find((r) => r.url.includes("/reports/trend"))!.url).searchParams;
    expect([trend.get("endPeriod"), trend.get("periods")]).toEqual(["2026-11", "2"]);
    expect(requests.filter((r) => r.url.includes("/reports/")).every((r) => r.url.includes("2026-11"))).toBe(
      true,
    );
    renderWithIntl(<DashOverview space={householdDto()} overview={result} formats={BUILT_IN_FORMATS} />);
    expect(screen.queryByRole("region", { name: "Aportes al fondo" })).toBeNull();
  });
});
