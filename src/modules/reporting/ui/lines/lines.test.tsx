import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e7Dashboard, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineDashboard } from "./line-dashboard";
import { NoPlan } from "./no-plan";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const tableRows = () =>
  within(screen.getByRole("table", { name: "Planeado, gastado y disponible por rubro" }))
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
      <LineDashboard
        dashboard={e7Dashboard()}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(tableRows()).toEqual([
      ["RentCumplido", "$ 1.200.000", "$ 1.200.000", "$ 0"],
      ["HomeCerca del límite", "$ 1.470.000", "$ 1.300.000", "$ 170.000"],
      ["Savings", "$ 600.000", "Ahorrado $ 0", "$ 600.000"],
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
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    const home = screen.getByRole("row", { name: /^Home/ });
    expect(within(home).getByText("Excedida")).toBeInTheDocument();
    expect(normalized(home.textContent)).toContain("−$ 130.000");
    expect(within(screen.getByRole("row", { name: /^Rent/ })).queryByText("Excedida")).toBeNull();
  });

  it("writes a small negative available figure in the owe ink, never the owe color that fails AA below 18.66 px", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = { ...dashboard.lines[1]!, available: cop(-130_000), overspent: true };
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    const available = (row: RegExp) =>
      within(screen.getByRole("row", { name: row }))
        .getAllByRole("cell")
        .at(-1) as HTMLElement;
    for (const row of [/^Home/, /^Sin presupuesto/]) {
      expect(available(row)).toHaveClass("text-owe-ink");
      expect(available(row)).not.toHaveClass("text-owe");
    }
    expect(available(/^Rent/)).not.toHaveClass("text-owe-ink");
  });

  it("shows the API's totals, never a sum of the rows (ruling P201)", () => {
    const totals = { planned: cop(1), spent: cop(2), available: cop(3) };
    renderWithIntl(
      <LineDashboard
        dashboard={e7Dashboard({ totals })}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
      />,
    );
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible$ 3");
    expect(normalized(summary.textContent)).toContain("Gastado $ 2 de $ 1");
  });

  it("shows no Unbudgeted row nor note when the plan has a catch-all line, and a negative total in the owe colour", () => {
    const totals = { planned: cop(100), spent: cop(150), available: cop(-50) };
    renderWithIntl(
      <LineDashboard
        dashboard={e7Dashboard({ unbudgeted: null, totals })}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.queryByText("Sin presupuesto")).toBeNull();
    expect(screen.queryByText(/no están en ningún rubro/)).toBeNull();
    expect(screen.getByText("−$ 50")).toHaveClass("text-owe");
  });

  it("says when a line nears or passes its plan, the overage in words (#142, ruling P244 of M6c)", async () => {
    const dashboard = e7Dashboard();
    dashboard.lines[0] = {
      ...dashboard.lines[0]!,
      spent: cop(1_150_000),
      available: cop(50_000),
      state: "HIGH",
    };
    dashboard.lines[1] = {
      ...dashboard.lines[1]!,
      spent: cop(1_600_000),
      available: cop(-130_000),
      overspent: true,
      state: "OVER",
      overBy: cop(130_000),
    };
    dashboard.lines[3] = { ...dashboard.lines[3]!, state: "NEAR" };
    const { container } = renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    const row = (name: RegExp) => screen.getByRole("row", { name });
    expect(within(row(/^Free/)).getByText("Cerca del límite")).toHaveAttribute("data-tone", "neutral");
    expect(within(row(/^Rent/)).getByText("Al límite")).toHaveAttribute("data-tone", "owe");
    const home = normalized(row(/^Home/).textContent);
    expect(home).toContain("Excedida");
    expect(home).toContain("Te pasaste por $ 130.000");
    expect(home).not.toMatch(/%/);
    expect(within(row(/^Savings/)).queryByText(/límite|Te pasaste/)).toBeNull();
    expect(within(row(/^Sin presupuesto/)).queryByText(/límite|Te pasaste/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("writes the overage the API answers, never one of its own (ruling P201)", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = {
      ...dashboard.lines[1]!,
      available: cop(-130_000),
      overspent: true,
      state: "OVER",
      overBy: cop(5),
    };
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    expect(normalized(screen.getByRole("row", { name: /^Home/ }).textContent)).toContain(
      "Te pasaste por $ 5",
    );
  });

  it("shows all spending under Unbudgeted and offers managers to create or copy a plan (2027-01)", async () => {
    const january = { label: "2027-01", startDate: "2027-01-01", endDate: "2027-01-31" };
    const dashboard = e7Dashboard({
      period: january,
      plan: null,
      lines: [],
      unbudgeted: { spent: cop(100_000), available: cop(-100_000), overspent: true },
      totals: { planned: cop(0), spent: cop(100_000), available: cop(-100_000) },
    });
    const owner = renderWithIntl(
      <NoPlan space={householdDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "enero 2027 no tiene plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar plan anterior" })).toBeInTheDocument();
    expect(tableRows()).toEqual([["Sin presupuesto", "$ 0", "$ 100.000", "−$ 100.000"]]);
    expect(await axeViolations(owner.container)).toEqual([]);
    owner.unmount();
    renderWithIntl(
      <NoPlan space={householdDto({ role: "MEMBER" })} dashboard={dashboard} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.queryByRole("button", { name: "Crear plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copiar plan anterior" })).toBeNull();
    expect(screen.getByText("Solo Propietario y Administrador pueden crear el plan.")).toBeInTheDocument();
  });

  it("offers a VIEWER nothing to create, and an ADMIN the same actions as the owner", () => {
    const dashboard = e7Dashboard({ plan: null, lines: [] });
    const viewer = renderWithIntl(
      <NoPlan space={householdDto({ role: "VIEWER" })} dashboard={dashboard} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.queryByRole("button", { name: "Crear plan" })).toBeNull();
    viewer.unmount();
    renderWithIntl(
      <NoPlan space={householdDto({ role: "ADMIN" })} dashboard={dashboard} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.getByRole("button", { name: "Crear plan" })).toBeInTheDocument();
  });

  it("shows what a line carried and from which closed plan, or that it waits for that plan to close (#143, rulings P231 and P243)", () => {
    const october = {
      planId: "p-oct",
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
    };
    const dashboard = e7Dashboard();
    dashboard.lines[1] = {
      ...dashboard.lines[1]!,
      carryOver: cop(200_000),
      available: cop(370_000),
      carryOverFrom: { ...october, closed: true },
    };
    dashboard.lines[3] = {
      ...dashboard.lines[3]!,
      carryOver: cop(-130_000),
      available: cop(350_000),
      carryOverFrom: { ...october, closed: true },
    };
    dashboard.lines[2] = { ...dashboard.lines[2]!, carryOverFrom: { ...october, closed: false } };
    const { container } = renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    const home = normalized(screen.getByRole("row", { name: /^Home/ }).textContent);
    expect(home).toContain("+$ 200.000 de octubre 2026");
    expect(home).toContain("$ 370.000");
    expect(normalized(screen.getByRole("row", { name: /^Free/ }).textContent)).toContain(
      "−$ 130.000 de octubre 2026",
    );
    expect(normalized(screen.getByRole("row", { name: /^Savings/ }).textContent)).toContain(
      "Se arrastra de octubre 2026 cuando ese plan se cierre.",
    );
    expect(screen.getByRole("row", { name: /^Rent/ }).textContent).not.toMatch(/octubre|arrastra/);
    expect(container.querySelector("[data-line='l-home'] [data-bar]")).toHaveStyle({ width: "77%" });
  });

  it("names the source of a carry in English, and an open source by the plan it waits for", () => {
    const october = {
      planId: "p-oct",
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
    };
    const dashboard = e7Dashboard();
    dashboard.lines[1] = {
      ...dashboard.lines[1]!,
      carryOver: cop(200_000),
      carryOverFrom: { ...october, closed: true },
    };
    dashboard.lines[3] = { ...dashboard.lines[3]!, carryOverFrom: { ...october, closed: false } };
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
      { locale: "en" },
    );
    expect(normalized(screen.getByRole("row", { name: /^Home/ }).textContent)).toContain(
      "+$ 200.000 from October 2026",
    );
    expect(normalized(screen.getByRole("row", { name: /^Free/ }).textContent)).toContain(
      "Carries over from October 2026 once that plan is closed.",
    );
  });

  it("explains the default split in English", () => {
    const dashboard = e7Dashboard({ plan: null, lines: [] });
    renderWithIntl(<NoPlan space={householdDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} />, {
      locale: "en",
    });
    expect(screen.getByRole("heading", { level: 2, name: "November 2026 has no plan" })).toBeInTheDocument();
    expect(screen.getByText(/the default split is equal shares/)).toBeInTheDocument();
  });
});

describe("the plan in the household's words (#214)", () => {
  const show = (dashboard = e7Dashboard(), locale: "es" | "en" = "es") =>
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
      { locale },
    );
  const row = (name: RegExp) => screen.getByRole("row", { name });
  const withSaving = () => {
    const dashboard = e7Dashboard();
    dashboard.lines[2] = { ...dashboard.lines[2]!, spent: cop(200_000), available: cop(400_000) };
    return dashboard;
  };

  it("reads a line spent exactly as planned as on plan, not as a warning", async () => {
    const { container } = show();
    const rent = row(/^Rent/);
    const badge = within(rent).getByText("Cumplido");
    expect(badge).toHaveAttribute("data-tone", "accent");
    expect(badge.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(within(rent).queryByText("Al límite")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps the warning for a line above 90 % that still has money left", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[0] = { ...dashboard.lines[0]!, spent: cop(1_150_000), available: cop(50_000) };
    show(dashboard);
    expect(within(row(/^Rent/)).getByText("Al límite")).toHaveAttribute("data-tone", "owe");
    expect(within(row(/^Rent/)).queryByText("Cumplido")).toBeNull();
  });

  it("says what reached a savings line is saved, not spent", () => {
    show(withSaving());
    const [, saved] = within(row(/^Savings/)).getAllByRole("cell");
    expect(saved).toHaveAttribute("data-label", "Ahorrado");
    expect(normalized(saved!.textContent)).toBe("Ahorrado $ 200.000");
    const [, spent] = within(row(/^Home/)).getAllByRole("cell");
    expect(spent).toHaveAttribute("data-label", "Gastado");
    expect(normalized(spent!.textContent)).toBe("$ 1.300.000");
  });

  it("reads the same in English", () => {
    show(withSaving(), "en");
    expect(within(row(/^Rent/)).getByText("On plan")).toBeInTheDocument();
    const [, saved] = within(row(/^Savings/)).getAllByRole("cell");
    expect(saved).toHaveAttribute("data-label", "Saved");
    expect(normalized(saved!.textContent)).toBe("Saved $ 200.000");
  });
});
