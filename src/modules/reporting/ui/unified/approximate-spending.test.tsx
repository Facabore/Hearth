import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, money, normalized } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ApproximateSpending, approximateFigureOf } from "./approximate-spending";

/** Board "Inicio · total aproximado": 1.240.000 COP, 80 USD and 25 EUR, ≈ 1.660.000 COP at today's rate. */
const SPENDING = {
  byCurrency: [cop(1_240_000), money(80, "USD"), money(25, "EUR")],
  approximate: { total: cop(1_660_000), unrated: [] },
};

describe('Inicio\'s month across currencies (ruling P342 S6, board "Inicio · total aproximado")', () => {
  it("reads the figure with ≈, never breaking, and says what it adds up under it", async () => {
    expect(approximateFigureOf({ currency: "COP", spending: SPENDING }, BUILT_IN_FORMATS)).toBe(
      "≈ 1.660.000 COP",
    );
    const { container } = renderWithIntl(
      <ApproximateSpending currency="COP" spending={SPENDING} formats={BUILT_IN_FORMATS} />,
    );
    expect(normalized(container.textContent)).toBe(
      "1.240.000 COP · 80 USD · 25 EUR. En pesos, a la tasa de hoy.",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists a currency with no rate today apart", () => {
    renderWithIntl(
      <ApproximateSpending
        currency="COP"
        spending={{
          byCurrency: [cop(100_000), money(1_000, "ARS")],
          approximate: { total: cop(100_000), unrated: [money(1_000, "ARS")] },
        }}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(normalized(screen.getByText(/^Sin tasa hoy/).textContent)).toBe("Sin tasa hoy: 1.000 ARS.");
  });

  it("speaks English", () => {
    const { container } = renderWithIntl(
      <ApproximateSpending currency="EUR" spending={SPENDING} formats={BUILT_IN_FORMATS} />,
      { locale: "en" },
    );
    expect(normalized(container.textContent)).toBe(
      "1.240.000 COP · 80 USD · 25 EUR. In euros, at today's rate.",
    );
  });

  it("shows nothing apart when the month is in one currency, or the API sent no spending", () => {
    const one = { currency: "COP", spending: { byCurrency: [cop(250_000)] } };
    expect(approximateFigureOf(one, BUILT_IN_FORMATS)).toBeNull();
    expect(approximateFigureOf({ currency: "COP" }, BUILT_IN_FORMATS)).toBeNull();
  });
});
