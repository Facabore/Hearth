import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { dashLine, e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { PlanCard } from "./plan-card";

const MONTHLY = { kind: "MONTHLY", day: 1 } as const;
const HREF = "/spaces/sp-personal/plan";

const personal = (overrides: Parameters<typeof e7Dashboard>[0] = {}) =>
  e7Dashboard({ spaceId: "sp-personal", ...overrides });

const card = () => screen.getByRole("link", { name: /^Tu plan de/ });

describe('Inicio\'s plan card, "Tu plan de {mes}" (ruling P311, #275)', () => {
  it("names the month, says what is left of what was planned, and opens the Plan screen as one link", async () => {
    const { container } = renderWithIntl(
      <PlanCard dashboard={personal()} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
    );
    expect(card()).toHaveAttribute("href", HREF);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Tu plan de noviembre")).toBeInTheDocument();
    expect(normalized(screen.getByText(/^Te quedan/).textContent)).toBe(
      "Te quedan $ 1.190.000 de $ 4.000.000",
    );
    // The bar is decoration: the words say it.
    const bar = container.querySelector("[data-plan-bar]");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/se pasó/)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a period that is not a calendar month by its dates", () => {
    renderWithIntl(
      <PlanCard
        dashboard={personal({
          period: { label: "2026-10-15", startDate: "2026-10-15", endDate: "2026-11-14" },
        })}
        policy={{ kind: "MONTHLY", day: 15 }}
        formats={BUILT_IN_FORMATS}
        href={HREF}
      />,
    );
    expect(screen.getByText("Tu plan del 15/10/2026 al 14/11/2026")).toBeInTheDocument();
  });

  it("says which line went over, and by how much, in words", () => {
    const dashboard = personal({
      lines: [
        dashLine("l-food", "Mercado", [500_000, 380_000, 120_000]),
        dashLine("l-fun", "Salidas", [200_000, 245_000, -45_000]),
      ],
    });
    renderWithIntl(
      <PlanCard dashboard={dashboard} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
    );
    expect(normalized(screen.getByText(/se pasó/).textContent)).toBe(
      "Salidas se pasó: $ 45.000 más de lo planeado",
    );
  });

  it("names the line that went over the most, and counts the others", () => {
    const dashboard = personal({
      lines: [
        dashLine("l-food", "Mercado", [500_000, 520_000, -20_000]),
        dashLine("l-fun", "Salidas", [200_000, 245_000, -45_000]),
        dashLine("l-bus", "Transporte", [100_000, 110_000, -10_000]),
        dashLine("l-rent", "Arriendo", [1_000_000, 1_000_000, 0]),
      ],
    });
    renderWithIntl(
      <PlanCard dashboard={dashboard} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
    );
    expect(normalized(screen.getByText(/se pasó/).textContent)).toBe(
      "Salidas se pasó: $ 45.000 más de lo planeado · y 2 más",
    );
  });

  it("shows nothing for a period without a plan, or with a plan without lines", () => {
    const none = renderWithIntl(
      <PlanCard
        dashboard={personal({ plan: null, lines: [] })}
        policy={MONTHLY}
        formats={BUILT_IN_FORMATS}
        href={HREF}
      />,
    );
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();
    const empty = renderWithIntl(
      <PlanCard
        dashboard={personal({ lines: [], totals: { planned: cop(0), spent: cop(0), available: cop(0) } })}
        policy={MONTHLY}
        formats={BUILT_IN_FORMATS}
        href={HREF}
      />,
    );
    expect(empty.container).toBeEmptyDOMElement();
  });

  describe("a plan the period's spending went past", () => {
    const overspent = personal({
      totals: { planned: cop(4_000_000), spent: cop(4_250_000), available: cop(-250_000) },
    });
    /** No-break spaces between symbol and digits, and no minus sign: the words carry the direction. */
    const NBSP_AMOUNT = /\$\u00A0250\.000/;

    it("says how much it went over, in words, never with a minus sign", () => {
      renderWithIntl(
        <PlanCard dashboard={overspent} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
      );
      const text = screen.getByText(/^Te pasaste/).textContent;
      expect(normalized(text)).toBe("Te pasaste $ 250.000 de $ 4.000.000 planeados");
      expect(text).toMatch(NBSP_AMOUNT);
      expect(text).not.toMatch(/[−-]/);
      expect(screen.queryByText(/^Te quedan/)).toBeNull();
    });

    it("says it in English too", () => {
      renderWithIntl(
        <PlanCard dashboard={overspent} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
        { locale: "en" },
      );
      expect(normalized(screen.getByText(/over the/).textContent)).toBe(
        "$ 250.000 over the $ 4.000.000 planned",
      );
    });
  });

  it("speaks English when the person does", () => {
    renderWithIntl(
      <PlanCard dashboard={personal()} policy={MONTHLY} formats={BUILT_IN_FORMATS} href={HREF} />,
      {
        locale: "en",
      },
    );
    expect(screen.getByText("Your November plan")).toBeInTheDocument();
    expect(normalized(screen.getByText(/left of/).textContent)).toBe("$ 1.190.000 left of $ 4.000.000");
  });
});
