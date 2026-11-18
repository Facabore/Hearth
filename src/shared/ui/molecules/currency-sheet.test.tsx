import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CurrencySheet } from "./currency-sheet";

const sheet = (onChoose = vi.fn(), value = "USD") =>
  renderWithIntl(
    <CurrencySheet
      open
      onOpenChange={vi.fn()}
      title="Moneda de la cuenta"
      value={value}
      primary="COP"
      primaryNote="la de Personal"
      onChoose={onChoose}
    />,
  );

describe("currency sheet (D29, board 13)", () => {
  it("offers the primary currency, USD and EUR first, then every other one, with a check on the chosen one", async () => {
    const { container } = sheet();
    const dialog = screen.getByRole("dialog", { name: "Moneda de la cuenta" });
    const mostUsed = within(dialog).getByRole("region", { name: "Más usadas" });
    const names = within(mostUsed)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      expect.stringContaining("Peso colombianoCOP · la de Personal"),
      expect.stringContaining("Dólar estadounidenseUSD"),
      expect.stringContaining("EuroEUR"),
    ]);
    expect(within(mostUsed).getByRole("button", { name: /Dólar estadounidense/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const all = within(dialog).getByRole("region", { name: "Todas" });
    expect(within(all).getByRole("button", { name: /Yen japonés/ })).toHaveTextContent("JPY · sin decimales");
    expect(within(all).queryByRole("button", { name: /Euro/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("badges each currency with its own code, never a symbol (P342, board 7)", () => {
    sheet();
    const mostUsed = within(screen.getByRole("dialog")).getByRole("region", { name: "Más usadas" });
    const badges = within(mostUsed)
      .getAllByRole("button")
      .map((b) => b.querySelector("[aria-hidden]")?.textContent);
    expect(badges).toEqual(["COP", "USD", "EUR"]);
  });

  it("finds a currency by its name or its code, accents ignored, and chooses it", async () => {
    const onChoose = vi.fn();
    sheet(onChoose);
    const search = screen.getByLabelText("Buscar");
    expect(search).toHaveAttribute("placeholder", "Busca por nombre o código");
    await userEvent.type(search, "japones");
    expect(screen.queryByRole("region", { name: "Más usadas" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Todas" })).getAllByRole("button")).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "mxn");
    await userEvent.click(screen.getByRole("button", { name: /Peso mexicano/ }));
    expect(onChoose).toHaveBeenCalledWith("MXN");
  });

  it("says so when nothing matches", async () => {
    sheet();
    await userEvent.type(screen.getByLabelText("Buscar"), "zzz");
    expect(screen.getByText("Ninguna moneda coincide con «zzz».")).toBeInTheDocument();
  });
});
