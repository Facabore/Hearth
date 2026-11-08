import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { MoreScreen } from "./more-screen";

describe("Más, the space's modules (ruling P311)", () => {
  it("draws a grid of square tiles in three columns: Configuración, Cuentas, Categorías and Recurrentes open", async () => {
    const { container } = renderWithIntl(<MoreScreen spaceId="sp-household" />);
    expect(screen.getByRole("heading", { level: 1, name: "Más" })).toBeInTheDocument();
    const grid = screen.getByRole("list");
    expect(grid).toHaveClass("grid", "grid-cols-3");
    expect(
      within(grid)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Configuración", "/spaces/sp-household/settings"],
      ["Cuentas", "/spaces/sp-household/accounts"],
      ["Categorías", "/spaces/sp-household/categories"],
      ["Recurrentes", "/spaces/sp-household/recurrences"],
    ]);
    for (const tile of within(grid).getAllByRole("link")) {
      expect(tile).toHaveClass("aspect-square", "min-h-11", "text-center");
      expect(tile.querySelector("svg")).not.toBeNull();
    }
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows Estadísticas, Calendario and Exportar e importar as Próximamente, muted and not links", () => {
    renderWithIntl(<MoreScreen spaceId="sp-household" />);
    const grid = screen.getByRole("list");
    const soon = within(grid)
      .getAllByRole("listitem")
      .filter((item) => within(item).queryByRole("link") === null);
    expect(soon.map((item) => item.textContent)).toEqual([
      "EstadísticasPróximamente",
      "CalendarioPróximamente",
      "Exportar e importarPróximamente",
    ]);
    for (const item of soon) expect(item.firstElementChild).toHaveClass("text-muted");
    expect(
      screen.getByText("Tus datos, formatos e idioma están en tu foto, arriba a la derecha."),
    ).toHaveClass("text-muted");
  });

  it("words the tiles in English", () => {
    renderWithIntl(<MoreScreen spaceId="sp-household" />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeInTheDocument();
    expect(screen.getAllByText(en.shell.more.soon)).toHaveLength(3);
  });
});
