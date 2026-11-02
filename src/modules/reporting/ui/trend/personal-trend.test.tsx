import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { sixMonthsTrend } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { PersonalTrend } from "./personal-trend";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const show = (locale: "es" | "en" = "es") =>
  renderWithIntl(
    <PersonalTrend space={spaceDto()} trend={sixMonthsTrend()} formats={BUILT_IN_FORMATS} periods={6} />,
    { locale },
  );

describe("personal trend (HU-E9-11, board E9-11 03 under ruling P272)", { timeout: 60_000 }, () => {
  it("draws the chart in a card with the hint under it", async () => {
    const { container } = show();
    const figure = screen.getByRole("figure", { name: "Mi consumo por período" });
    expect(figure).toHaveClass("rounded-2xl", "border", "bg-surface");
    expect(
      within(figure).getByText("Pasa el dedo o el cursor por un punto para ver su valor."),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("trend-chart", {}, { timeout: 45_000 })).toHaveAttribute(
      "data-points",
      "6",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists the periods newest first in a card, by their short name, the current one in bold", () => {
    show();
    const table = screen.getByRole("table", { name: "Consumo por período" });
    expect(table.closest("[data-table-card]")).toHaveClass("rounded-2xl", "border", "bg-surface");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => normalized(within(row).getByRole("rowheader").textContent))).toEqual([
      "nov 2026",
      "oct 2026",
      "sep 2026",
      "ago 2026",
      "jul 2026",
      "jun 2026",
    ]);
    expect(rows[0]).toHaveClass("font-semibold");
    expect(rows[1]).not.toHaveClass("font-semibold");
  });

  it("writes each change with its sign and percentage, without a chip, and the first period as having none before", () => {
    show();
    const table = screen.getByRole("table", { name: "Consumo por período" });
    const cells = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => normalized(within(row).getAllByRole("cell").at(-1)!.textContent));
    expect(cells).toEqual([
      "+$ 75.000 (+5,00 %)",
      "+$ 200.000 (+15,38 %)",
      "−$ 150.000 (−10,34 %)",
      "$ 0 (0,00 %)",
      "+$ 50.000 (+3,57 %)",
      "Sin período anterior",
    ]);
    expect(within(table).queryByText(/Subió|Bajó|Igual|Nueva/)).toBeNull();
  });

  it("reads the same in English", () => {
    show("en");
    expect(screen.getByText("Hover or drag over a point to see its value.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Consumption by period" });
    expect(normalized(within(table).getAllByRole("rowheader")[0]!.textContent)).toBe("Nov 2026");
  });
});
