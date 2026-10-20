import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { VisuallyHidden } from "./visually-hidden";

describe("VisuallyHidden", () => {
  it("names an icon-only control for assistive technology", async () => {
    const { container } = render(
      <button type="button">
        <svg aria-hidden="true" />
        <VisuallyHidden>Cerrar</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
