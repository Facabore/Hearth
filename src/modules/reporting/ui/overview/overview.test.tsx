import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
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
});
