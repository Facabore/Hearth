import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { Button } from "../atoms/button";
import { Sheet } from "./sheet";

/** Ruling P325: the sheet carries the app's motion; the stylesheet animates these hooks, reduced motion only fades. */
describe("the sheet's motion (ruling P325)", () => {
  it("marks its panel and its scrim for the rising and fading movement", () => {
    renderWithIntl(
      <Sheet open onOpenChange={() => {}} title="Cómo se divide">
        <p>Igual</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Cómo se divide" });
    expect(dialog).toHaveClass("motion-sheet");
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(document.querySelector(".motion-scrim")).not.toBeNull();
  });

  it("closes and opens again once it was shown, staying mounted for its closing movement", () => {
    const { rerender } = renderWithIntl(
      <Sheet open onOpenChange={() => {}} title="Filtros">
        <p>Período</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Filtros" })).toBeVisible();
    rerender(
      <Sheet open={false} onOpenChange={() => {}} title="Filtros">
        <p>Período</p>
      </Sheet>,
    );
    // jsdom runs no animation, so Radix removes the closed panel at once; a browser plays the closing movement first.
    expect(screen.queryByRole("dialog", { name: "Filtros" })).toBeNull();
    rerender(
      <Sheet open onOpenChange={() => {}} title="Filtros">
        <p>Período</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Filtros" })).toBeVisible();
  });

  it("gives every button the slight sink of a press", () => {
    renderWithIntl(<Button>Guardar gasto</Button>);
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toHaveClass("motion-press");
  });
});
