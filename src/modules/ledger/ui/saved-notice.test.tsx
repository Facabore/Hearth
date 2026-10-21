import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SavedNotice } from "./saved-notice";

describe("saved with a warning (HU-E9-06, ruling P170)", () => {
  it("says the expense was saved and the fund's balance is now -500,000 COP", async () => {
    const { container } = renderWithIntl(
      <SavedNotice
        accountName="Fondo Hogar"
        balance={cop(-500_000)}
        formats={BUILT_IN_FORMATS}
        dismissHref="/spaces/sp-household/transactions"
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Gasto guardado");
    expect(normalized(notice.textContent)).toContain(
      "El saldo de Fondo Hogar quedó en −$ 500.000. Pueden hacer un aporte al fondo para cubrirlo.",
    );
    expect(screen.getByRole("link", { name: "Cerrar aviso" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is a notice, not an error: it is a status and never an alert", () => {
    renderWithIntl(
      <SavedNotice
        accountName="Fondo Hogar"
        balance={cop(-500_000)}
        formats={BUILT_IN_FORMATS}
        dismissHref="/spaces/sp-household/transactions"
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads in English with the fund's balance in the person's formats", () => {
    renderWithIntl(
      <SavedNotice
        accountName="Household fund"
        balance={cop(-500_000)}
        formats={{ ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" }}
        dismissHref="/spaces/sp-household/transactions"
      />,
      { locale: "en" },
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Expense saved");
    expect(normalized(notice.textContent)).toContain("Household fund");
    expect(normalized(notice.textContent)).toContain("−$ 500,000");
    expect(screen.getByRole("link", { name: "Dismiss notice" })).toBeInTheDocument();
  });
});
