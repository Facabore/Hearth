import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, cop, groupDto, money, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import {
  dashBudget,
  e7Dashboard,
  householdDto,
  twoCurrencyDashboard,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineDashboard } from "./line-dashboard";
import { NoPlan } from "./no-plan";
import { unbudgetedNamesOf } from "./unbudgeted-names";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/** Board E9-10 01 (ruling P272): each line as its name, its right figure and its one caption. */
const lineRows = () =>
  within(screen.getByRole("list", { name: "Planeado, gastado y disponible por rubro" }))
    .getAllByRole("listitem")
    .map((item) => [
      normalized(item.querySelector("[data-name]")?.textContent),
      normalized(item.querySelector("[data-figure]")?.textContent),
      normalized(item.querySelector("[data-caption]")?.textContent),
    ]);
const figureOf = (name: RegExp) =>
  screen.getByRole("listitem", { name }).querySelector("[data-figure]") as HTMLElement;

describe("line dashboard (HU-E9-10)", () => {
  it("shows each line compact, its available or Cumplido and one caption, with Unbudgeted last (@golden)", async () => {
    const { container } = renderWithIntl(
      <LineDashboard
        dashboard={e7Dashboard()}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(lineRows()).toEqual([
      ["Rent", "Cumplido", "Gastado 1.200.000 COP de 1.200.000 COP"],
      ["Home", "Disponible 170.000 COP", "Gastado 1.300.000 COP de 1.470.000 COP"],
      ["Savings", "Disponible 600.000 COP", "Ahorrado 0 COP de 600.000 COP"],
      ["Free", "Disponible 480.000 COP", "Gastado 250.000 COP de 730.000 COP"],
      ["Sin presupuesto", "Disponible −\u206060.000 COP", "Gastado 60.000 COP en categorías sin rubro"],
    ]);
    // A line near its limit wears no chip on the board; its bar and figure say it.
    expect(screen.queryByText("Cerca del límite")).toBeNull();
    expect(screen.queryByText(/no están en ningún rubro/)).toBeNull();
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible1.190.000 COP");
    expect(normalized(summary.textContent)).toContain("Gastado 2.810.000 COP de 4.000.000 COP");
    expect(container.querySelector("[data-line='l-home'] [data-bar]")).toHaveStyle({ width: "88%" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("never breaks a line's figure across lines; its name wraps beside it instead (AGENTS.md)", () => {
    renderWithIntl(
      <LineDashboard
        dashboard={e7Dashboard()}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
      />,
    );
    const figures = [...document.querySelectorAll("[data-figure]")];
    expect(figures.length).toBeGreaterThan(1);
    for (const amount of figures) {
      // P335: whole on one line, beside the name while they fit and under it when not.
      expect(amount).toHaveClass("whitespace-nowrap", "ml-auto");
      expect(amount.parentElement).toHaveClass("flex-wrap");
      expect(amount.className).not.toContain("overflow-wrap");
    }
  });

  it("names the categories Unbudgeted's spending fell into, as board E9-10 01 does (#240)", () => {
    renderWithIntl(
      <LineDashboard
        dashboard={e7Dashboard()}
        policy={householdDto().periodPolicy}
        formats={BUILT_IN_FORMATS}
        unbudgetedNames={["Restaurantes", "Taxis"]}
      />,
    );
    expect(lineRows().at(-1)).toEqual([
      "Sin presupuesto",
      "Disponible −\u206060.000 COP",
      "Gastado 60.000 COP en categorías sin rubro · Restaurantes, Taxis",
    ]);
  });

  it("names Unbudgeted's categories from the space's categories, in the API's order, archived ones too", () => {
    const groups = [
      groupDto({
        categories: [
          categoryDto({ id: "c-market", name: "Mercado" }),
          categoryDto({ id: "c-food-out", name: "Restaurantes", archivedAt: "2026-10-01T00:00:00.000Z" }),
        ],
      }),
      groupDto({ id: "g-move", categories: [categoryDto({ id: "c-taxi", name: "Taxis" })] }),
    ];
    expect(unbudgetedNamesOf(["c-taxi", "c-food-out", "c-gone"], groups)).toEqual(["Taxis", "Restaurantes"]);
    expect(unbudgetedNamesOf(undefined, groups)).toEqual([]);
    expect(unbudgetedNamesOf(["c-taxi"], undefined)).toEqual([]);
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
    const home = screen.getByRole("listitem", { name: /^Home/ });
    expect(within(home).getByText("Excedida")).toBeInTheDocument();
    expect(normalized(home.textContent)).toContain("−\u2060130.000 COP");
    expect(within(screen.getByRole("listitem", { name: /^Rent/ })).queryByText("Excedida")).toBeNull();
  });

  it("writes a small negative available figure in the owe ink, never the owe color that fails AA below 18.66 px", () => {
    const dashboard = e7Dashboard();
    dashboard.lines[1] = { ...dashboard.lines[1]!, available: cop(-130_000), overspent: true };
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
    );
    for (const row of [/^Home/, /^Sin presupuesto/]) {
      expect(figureOf(row)).toHaveClass("text-owe-ink");
      expect(figureOf(row)).not.toHaveClass("text-owe");
      // The sign says it too, never the color alone.
      expect(normalized(figureOf(row).textContent)).toMatch(/^Disponible −\u2060[\d.]+ COP$/);
    }
    expect(figureOf(/^Rent/)).not.toHaveClass("text-owe-ink");
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
    expect(normalized(summary.textContent)).toContain("Disponible3 COP");
    expect(normalized(summary.textContent)).toContain("Gastado 2 COP de 1 COP");
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
    expect(screen.queryByText(/categorías sin rubro/)).toBeNull();
    expect(screen.getByText("−\u206050 COP")).toHaveClass("text-owe");
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
    const row = (name: RegExp) => screen.getByRole("listitem", { name });
    expect(within(row(/^Free/)).queryByText("Cerca del límite")).toBeNull();
    expect(within(row(/^Rent/)).getByText("Al límite")).toHaveAttribute("data-tone", "owe");
    const home = normalized(row(/^Home/).textContent);
    expect(home).toContain("Excedida");
    expect(home).toContain("Te pasaste por 130.000 COP");
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
    expect(normalized(screen.getByRole("listitem", { name: /^Home/ }).textContent)).toContain(
      "Te pasaste por 5 COP",
    );
  });

  it("shows all spending under Unbudgeted and offers managers to create a plan first, or copy December's (2027-01)", async () => {
    const january = { label: "2027-01", startDate: "2027-01-01", endDate: "2027-01-31" };
    const december = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };
    const dashboard = e7Dashboard({
      period: january,
      plan: null,
      lines: [],
      unbudgeted: { spent: cop(100_000), available: cop(-100_000), overspent: true },
      totals: { planned: cop(0), spent: cop(100_000), available: cop(-100_000) },
    });
    const owner = renderWithIntl(
      <NoPlan space={householdDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} previous={december} />,
    );
    // Ruling P311 (board "Plan del mes de Hogar · sin plan, con uno anterior: Crear plan primero").
    expect(
      screen.getByRole("heading", { level: 2, name: "Household aún no tiene un plan para enero" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Un plan reparte lo que entra en rubros (Mercado, Arriendo, Transporte…) y les dice a todos cuánto queda en cada uno.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Crear plan",
      "Copiar el plan de diciembre",
    ]);
    expect(screen.getByText("Solo Propietario y Administrador ven estas acciones.")).toBeInTheDocument();
    // Board E9-10 02: no totals, and Unbudgeted as one compact card that names the month.
    expect(screen.queryByRole("region", { name: "Resumen del plan" })).toBeNull();
    expect(lineRows()).toEqual([
      ["Sin presupuesto", "Disponible −\u2060100.000 COP", "Gastado 100.000 COP en enero"],
    ]);
    expect(await axeViolations(owner.container)).toEqual([]);
    owner.unmount();
    renderWithIntl(
      <NoPlan space={householdDto({ role: "MEMBER" })} dashboard={dashboard} formats={BUILT_IN_FORMATS} />,
    );
    expect(screen.queryByRole("button", { name: "Crear plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
    expect(screen.getByText("Solo Propietario y Administrador pueden crear el plan.")).toBeInTheDocument();
    expect(screen.queryByText("Solo Propietario y Administrador ven estas acciones.")).toBeNull();
  });

  it("names a period that is not a calendar month as this period (ruling P205)", () => {
    const dashboard = e7Dashboard({
      plan: null,
      lines: [],
      unbudgeted: { spent: cop(100_000), available: cop(-100_000), overspent: true },
    });
    renderWithIntl(
      <NoPlan
        space={householdDto({ periodPolicy: { kind: "MONTHLY", day: 15 } })}
        dashboard={dashboard}
        formats={BUILT_IN_FORMATS}
        previous={{ label: "2026-10-15", startDate: "2026-10-15", endDate: "2026-11-14" }}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Household aún no tiene un plan para este período" }),
    ).toBeInTheDocument();
    // Ruling P311: the copy names the period it starts from by its dates.
    expect(
      screen.getByRole("button", { name: "Copiar el plan de 15/10/2026 – 14/11/2026" }),
    ).toBeInTheDocument();
    expect(lineRows()).toEqual([
      ["Sin presupuesto", "Disponible −\u2060100.000 COP", "Gastado 100.000 COP en este período"],
    ]);
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
    const home = normalized(screen.getByRole("listitem", { name: /^Home/ }).textContent);
    expect(home).toContain("+200.000 COP de octubre 2026");
    expect(home).toContain("370.000 COP");
    expect(normalized(screen.getByRole("listitem", { name: /^Free/ }).textContent)).toContain(
      "−\u2060130.000 COP de octubre 2026",
    );
    expect(normalized(screen.getByRole("listitem", { name: /^Savings/ }).textContent)).toContain(
      "Se arrastra de octubre 2026 cuando ese plan se cierre.",
    );
    expect(screen.getByRole("listitem", { name: /^Rent/ }).textContent).not.toMatch(/octubre|arrastra/);
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
    expect(normalized(screen.getByRole("listitem", { name: /^Home/ }).textContent)).toContain(
      "+200.000 COP from October 2026",
    );
    expect(normalized(screen.getByRole("listitem", { name: /^Free/ }).textContent)).toContain(
      "Carries over from October 2026 once that plan is closed.",
    );
  });

  it("says what a plan does in English", () => {
    const dashboard = e7Dashboard({ plan: null, lines: [] });
    renderWithIntl(
      <NoPlan space={householdDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} previous={null} />,
      { locale: "en" },
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Household doesn't have a plan for November yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/and tells everyone how much is left in each one.$/)).toBeInTheDocument();
    expect(screen.getByText(/^There is no previous plan to copy: once you have one/)).toBeInTheDocument();
  });

  it("speaks to the person in her own space, and offers no copy without a previous plan (ruling P311)", async () => {
    const dashboard = e7Dashboard({ spaceId: "sp-personal", plan: null, lines: [] });
    const { container } = renderWithIntl(
      <NoPlan space={spaceDto()} dashboard={dashboard} formats={BUILT_IN_FORMATS} previous={null} />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Aún no tienes un plan para noviembre" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Un plan reparte lo que entra en rubros (Mercado, Arriendo, Transporte…) y te dice cada día cuánto te queda en cada uno.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Crear plan"]);
    // #286 (audit pass 3, A11): the person is alone in her space, so no line about who sees the actions.
    expect(screen.queryByText("Solo Propietario y Administrador ven estas acciones.")).toBeNull();
    expect(
      screen.getByText(
        "No hay un plan anterior para copiar: cuando tengas uno, podrás empezar el mes siguiente desde él.",
      ),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("the plan in the household's words (#214)", () => {
  const show = (dashboard = e7Dashboard(), locale: "es" | "en" = "es") =>
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
      { locale },
    );
  const row = (name: RegExp) => screen.getByRole("listitem", { name });
  const withSaving = () => {
    const dashboard = e7Dashboard();
    dashboard.lines[2] = { ...dashboard.lines[2]!, spent: cop(200_000), available: cop(400_000) };
    return dashboard;
  };

  it("reads a line spent exactly as planned as on plan, not as a warning", async () => {
    const { container } = show();
    const rent = row(/^Rent/);
    // Board E9-10 01: "Cumplido" is the line's right figure, in words, where an amount would be.
    expect(normalized(rent.querySelector("[data-figure]")?.textContent)).toBe("Cumplido");
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

  const caption = (name: RegExp) => normalized(row(name).querySelector("[data-caption]")?.textContent);

  it("says what reached a savings line is saved, not spent", () => {
    show(withSaving());
    expect(caption(/^Savings/)).toBe("Ahorrado 200.000 COP de 600.000 COP");
    expect(caption(/^Home/)).toBe("Gastado 1.300.000 COP de 1.470.000 COP");
  });

  /** The API's totals with 200,000 COP saved: spent counts it, withoutSavings does not (ruling P262). */
  const savedTotals = () => {
    const dashboard = withSaving();
    return {
      ...dashboard,
      totals: {
        planned: cop(4_000_000),
        spent: cop(3_010_000),
        available: cop(990_000),
        saved: cop(200_000),
        withoutSavings: { planned: cop(3_400_000), spent: cop(2_810_000) },
      },
    };
  };

  it("keeps savings out of the Gastado headline, from the API's own figures (ruling P262)", async () => {
    const { container } = show(savedTotals());
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Gastado 2.810.000 COP de 3.400.000 COP");
    expect(normalized(summary.textContent)).toContain("Ahorrado 200.000 COP");
    expect(normalized(summary.textContent)).not.toContain("3.010.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("heads with what is left to spend, so savings not yet moved never read as money to spend (#283)", () => {
    const dashboard = savedTotals();
    show({
      ...dashboard,
      totals: {
        ...dashboard.totals,
        withoutSavings: { planned: cop(3_400_000), spent: cop(2_810_000), available: cop(590_000) },
      },
    });
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible590.000 COP");
    expect(normalized(summary.textContent)).not.toContain("990.000");
  });

  it("shows the figures the API answers, never a difference of its own (ruling P201)", () => {
    const dashboard = savedTotals();
    show({
      ...dashboard,
      totals: { ...dashboard.totals, saved: cop(7), withoutSavings: { planned: cop(5), spent: cop(3) } },
    });
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Gastado 3 COP de 5 COP");
    expect(normalized(summary.textContent)).toContain("Ahorrado 7 COP");
  });

  it("says nothing about savings when the plan has no savings line", () => {
    const dashboard = savedTotals();
    show({ ...dashboard, lines: dashboard.lines.filter((l) => l.funding !== "SAVINGS") });
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).not.toContain("Ahorrado");
  });

  it("keeps the savings apart in English too", () => {
    show(savedTotals(), "en");
    const summary = screen.getByRole("region", { name: "Plan summary" });
    expect(normalized(summary.textContent)).toContain("Spent 2.810.000 COP of 3.400.000 COP");
    expect(normalized(summary.textContent)).toContain("Saved 200.000 COP");
  });

  it("reads the same in English", () => {
    show(withSaving(), "en");
    expect(within(row(/^Rent/)).getByText("On plan")).toBeInTheDocument();
    expect(caption(/^Savings/)).toBe("Saved 200.000 COP of 600.000 COP");
    expect(caption(/^Home/)).toBe("Spent 1.300.000 COP of 1.470.000 COP");
  });
});

describe('the plan per currency (ruling P342 S7, board "Plan del mes · dos monedas")', () => {
  const show = (dashboard = twoCurrencyDashboard(), locale: "es" | "en" = "es") =>
    renderWithIntl(
      <LineDashboard dashboard={dashboard} policy={householdDto().periodPolicy} formats={BUILT_IN_FORMATS} />,
      { locale },
    );
  const budgetsOf = (name: RegExp) =>
    [...screen.getByRole("listitem", { name }).querySelectorAll("[data-budget]")].map((budget) => [
      normalized(budget.querySelector("[data-caption]")?.textContent),
      normalized(budget.querySelector("[data-state]")?.textContent),
    ]);

  it("heads with the space currency's figure, the other currencies under it, and every plan apart", async () => {
    const { container } = show();
    const summary = screen.getByRole("region", { name: "Resumen del plan" });
    expect(normalized(summary.textContent)).toContain("Disponible1.286.000 COP");
    expect(normalized(container.querySelector("[data-also]")?.textContent)).toBe("y 55 USD");
    expect(normalized(summary.textContent)).toContain(
      "Gastado 2.640.000 COP y 45 USD de 3.100.000 COP y 100 USD",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows each currency of a line apart: its caption, its state in words and its own bar", () => {
    const { container } = show();
    expect(budgetsOf(/^Salidas/)).toEqual([
      ["Gastado 340.000 COP de 300.000 COP", "se pasó 40.000 COP"],
      ["Gastado 45 USD de 100 USD", "quedan 55 USD"],
    ]);
    const states = container.querySelectorAll("[data-line='l-out'] [data-state]");
    // The overage is in words and in the owe ink, never by colour alone.
    expect(states[0]).toHaveClass("text-owe-ink");
    expect(states[1]).not.toHaveClass("text-owe-ink");
    const bars = container.querySelectorAll("[data-line='l-out'] [data-bar]");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveClass("bg-owe");
    expect(bars[1]).toHaveClass("bg-accent");
    expect(bars[1]).toHaveStyle({ width: "45%" });
  });

  it("draws a line budgeted only in the space currency exactly as before", () => {
    show();
    const rent = screen.getByRole("listitem", { name: /^Arriendo/ });
    expect(rent.querySelector("[data-budget]")).toBeNull();
    expect(normalized(rent.querySelector("[data-figure]")?.textContent)).toBe("Cumplido");
    expect(normalized(rent.querySelector("[data-caption]")?.textContent)).toBe(
      "Gastado 2.000.000 COP de 2.000.000 COP",
    );
    expect(rent.querySelectorAll("[data-bar]")).toHaveLength(1);
  });

  it("shows what a line spent in a currency it has no budget for as spent without a budget, never converted", () => {
    const dashboard = twoCurrencyDashboard();
    const food = dashboard.lines[1]!;
    dashboard.lines[1] = {
      ...food,
      budgets: [
        ...food.budgets!,
        dashBudget([money(0, "USD"), money(20, "USD"), money(-20, "USD")], { budgeted: false }),
      ],
    };
    const { container } = show(dashboard);
    // The API answers it OVER (nothing was planned in USD); it reads as spent without a budget, never as overspent.
    expect(dashboard.lines[1]!.budgets![1]!.state).toBe("OVER");
    expect(budgetsOf(/^Mercado/)).toEqual([
      ["Gastado 300.000 COP de 800.000 COP", "quedan 500.000 COP"],
      ["Gastado 20 USD sin presupuesto", ""],
    ]);
    expect(screen.getByRole("listitem", { name: /^Mercado/ }).textContent).not.toMatch(/se pasó|Excedida/);
    const bars = container.querySelectorAll("[data-line='l-food'] [data-bar]");
    expect(bars[1]).toHaveClass("bg-muted");
    expect(bars[1]).not.toHaveClass("bg-owe");
  });

  it("leaves a currency only spent in, with nothing planned, out of the plan's figures", () => {
    const dashboard = twoCurrencyDashboard();
    const eur = (major: number) => money(major, "EUR");
    const totals = { planned: eur(0), spent: eur(20), available: eur(-20) };
    dashboard.currencies = [
      ...dashboard.currencies!,
      { unbudgeted: null, totals: { ...totals, saved: eur(0), withoutSavings: totals } },
    ];
    const { container } = show(dashboard);
    expect(normalized(container.querySelector("[data-also]")?.textContent)).toBe("y 55 USD");
    expect(normalized(screen.getByRole("region", { name: "Resumen del plan" }).textContent)).not.toContain(
      "EUR",
    );
  });

  it("keeps a plan in one currency without the other currencies' line", () => {
    const { container } = show(e7Dashboard());
    expect(container.querySelector("[data-also]")).toBeNull();
  });

  it("reads the same in English", () => {
    const { container } = show(twoCurrencyDashboard(), "en");
    expect(normalized(container.querySelector("[data-also]")?.textContent)).toBe("and 55 USD");
    expect(budgetsOf(/^Salidas/)).toEqual([
      ["Spent 340.000 COP of 300.000 COP", "40.000 COP over"],
      ["Spent 45 USD of 100 USD", "55 USD left"],
    ]);
  });
});
