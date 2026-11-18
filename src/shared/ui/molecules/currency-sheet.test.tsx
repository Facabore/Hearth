import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CurrencySheet } from "./currency-sheet";

const sheet = (onChoose = vi.fn(), value = "USD", favorites: readonly string[] = ["USD", "COP", "EUR"]) =>
  renderWithIntl(
    <CurrencySheet
      open
      onOpenChange={vi.fn()}
      title="Moneda de la cuenta"
      value={value}
      primary="COP"
      primaryNote="por defecto en Personal"
      favorites={favorites}
      onChoose={onChoose}
    />,
  );

const buttonsIn = (region: string) =>
  within(within(screen.getByRole("dialog")).getByRole("region", { name: region })).getAllByRole("button");

describe("currency sheet (D29, board 13; P342, board 7)", () => {
  it("offers the space's currency first, then the person's favorites in their order, then every other one", async () => {
    const { container } = sheet();
    const dialog = screen.getByRole("dialog", { name: "Moneda de la cuenta" });
    expect(
      within(dialog)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["De este espacio", "Favoritas", "Todas"]);
    expect(buttonsIn("De este espacio").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Peso colombianoCOP · por defecto en Personal"),
    ]);
    // The space's currency is never repeated among the favorites, which keep the person's order.
    expect(buttonsIn("Favoritas").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Dólar estadounidenseUSD"),
      expect.stringContaining("EuroEUR"),
    ]);
    expect(within(dialog).getByRole("button", { name: /Dólar estadounidense/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const all = within(dialog).getByRole("region", { name: "Todas" });
    expect(within(all).getByRole("button", { name: /Yen japonés/ })).toHaveTextContent("JPY · sin decimales");
    expect(within(all).queryByRole("button", { name: /Euro/ })).toBeNull();
    expect(within(all).queryByRole("button", { name: /Peso colombiano/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("leaves Favoritas out when the person has none besides the space's currency", () => {
    sheet(vi.fn(), "COP", ["COP"]);
    expect(screen.queryByRole("region", { name: "Favoritas" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Todas" })).getByRole("button", {
        name: /Dólar estadounidense/,
      }),
    ).toBeInTheDocument();
  });

  it("badges each currency with its own code, never a symbol (P342, board 7)", () => {
    sheet();
    const badges = [...buttonsIn("De este espacio"), ...buttonsIn("Favoritas")].map(
      (b) => b.querySelector("[aria-hidden]")?.textContent,
    );
    expect(badges).toEqual(["COP", "USD", "EUR"]);
  });

  it("finds a currency by its name or its code, accents ignored, and chooses it", async () => {
    const onChoose = vi.fn();
    sheet(onChoose);
    const search = screen.getByLabelText("Buscar");
    expect(search).toHaveAttribute("placeholder", "Busca por nombre o código");
    await userEvent.type(search, "japones");
    expect(screen.queryByRole("region", { name: "De este espacio" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Favoritas" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Todas" })).getAllByRole("button")).toHaveLength(1);
    await userEvent.clear(search);
    await userEvent.type(search, "eur");
    expect(buttonsIn("Favoritas")).toHaveLength(1);
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
