import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineDashboard } from "./line-dashboard";

const tableRows = () =>
  within(screen.getByRole("table", { name: "Planeado, gastado y disponible por línea" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => [
      normalized(within(row).getByRole("rowheader").textContent).trim(),
      ...within(row)
        .getAllByRole("cell")
        .map((cell) => normalized(cell.textContent)),
    ]);

describe("line dashboard (HU-E9-10)", () => {
  it("shows the bars and table of planned, spent and available, with Unbudgeted last (@golden)", async () => {
    const { container } = renderWithIntl(
      <LineDashboard dashboard={e7Dashboard()} formats={BUILT_IN_FORMATS} />,
    );
    expect(tableRows()).toEqual([
      ["Rent", "$ 1.200.000", "$ 1.200.000", "$ 0"],
      ["Home", "$ 1.470.000", "$ 1.300.000", "$ 170.000"],
      ["Savings", "$ 600.000", "$ 0", "$ 600.000"],
      ["Free", "$ 730.000", "$ 250.000", "$ 480.000"],
      ["Sin presupuesto", "$ 0", "$ 60.000", "−$ 60.000"],
    ]);
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible$ 1.190.000");
    expect(normalized(summary.textContent)).toContain("Gastado $ 2.810.000 de $ 4.000.000");
    expect(container.querySelector("[data-line='l-home'] [data-bar]")).toHaveStyle({ width: "88%" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("highlights an overspent line with its badge and its negative available amount", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = {
      ...dashboard.lines[1]!,
      spent: cop(1_600_000),
      available: cop(-130_000),
      overspent: true,
    };
    renderWithIntl(<LineDashboard dashboard={dashboard} formats={BUILT_IN_FORMATS} />);
    const home = screen.getByRole("row", { name: /^Home/ });
    expect(within(home).getByText("Excedida")).toBeInTheDocument();
    expect(normalized(home.textContent)).toContain("−$ 130.000");
    expect(within(screen.getByRole("row", { name: /^Rent/ })).queryByText("Excedida")).toBeNull();
  });

  it("shows the API's totals, never a sum of the rows (ruling P201)", () => {
    const totals = { planned: cop(1), spent: cop(2), available: cop(3) };
    renderWithIntl(<LineDashboard dashboard={e7Dashboard({ totals })} formats={BUILT_IN_FORMATS} />);
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible$ 3");
    expect(normalized(summary.textContent)).toContain("Gastado $ 2 de $ 1");
  });

  it("shows no Unbudgeted row nor note when the plan has a catch-all line, and a negative total in the owe colour", () => {
    const totals = { planned: cop(100), spent: cop(150), available: cop(-50) };
    renderWithIntl(
      <LineDashboard dashboard={e7Dashboard({ unbudgeted: null, totals })} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.queryByText("Sin presupuesto")).toBeNull();
    expect(screen.queryByText(/no están en ninguna línea/)).toBeNull();
    expect(screen.getByText("−$ 50")).toHaveClass("text-owe");
  });
});
