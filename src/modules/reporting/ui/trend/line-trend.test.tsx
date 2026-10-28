import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized } from "../../../../../tests/support/ui/dto";
import { homeTrend, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineTrend } from "./line-trend";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("line trend (HU-E9-11)", () => {
  // The first load of the lazy Recharts chunk is slow on a cold transform cache, as in CI.
  it(
    "shows Home at −50.000 (−3,70 %) and Pets with the New badge, chart and table from one series",
    { timeout: 60_000 },
    async () => {
      const { container } = renderWithIntl(
        <LineTrend space={householdDto()} trend={homeTrend()} formats={BUILT_IN_FORMATS} periods={6} />,
      );
      const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
      expect(home).toContain("$ 1.300.000");
      expect(home).toContain("−$ 50.000 (−3,70 %)");
      expect(home).toContain("Bajó");
      const pets = normalized(screen.getByRole("listitem", { name: "Pets" }).textContent);
      expect(pets).toContain("Nueva");
      expect(pets).not.toContain("%");
      expect(await screen.findByTestId("trend-chart", {}, { timeout: 45_000 })).toHaveAttribute(
        "data-points",
        "6",
      );
      const table = screen.getByRole("table", { name: "Gastado por línea y período" });
      expect(normalized(table.textContent)).toContain("$ 1.350.000");
      expect(screen.getByRole("region", { name: "Gastado por línea y período" })).toHaveAttribute(
        "tabindex",
        "0",
      );
      expect(await axeViolations(container)).toEqual([]);
    },
  );

  it("says that a period without a plan has no lines to compare", () => {
    renderWithIntl(
      <LineTrend
        space={householdDto()}
        trend={{ ...homeTrend(), plan: null, lines: [] }}
        formats={BUILT_IN_FORMATS}
        periods={6}
      />,
    );
    expect(screen.getByText("Este período no tiene plan: no hay líneas que comparar.")).toBeInTheDocument();
  });
});
