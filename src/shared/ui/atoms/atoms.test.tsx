import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { Button } from "./button";
import { Switch } from "./switch";
import { TextField } from "./text-field";

describe("atoms", () => {
  it("renders a link as a button when asked", async () => {
    renderWithIntl(
      <Button asChild variant="secondary">
        <a href="/sign-up">Crear una cuenta</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Crear una cuenta" })).toHaveAttribute("href", "/sign-up");
  });

  it("ties a field's label, hint and error together for assistive technology", async () => {
    const { container } = renderWithIntl(
      <TextField
        id="su-email"
        label="Correo electrónico"
        hint="Te escribiremos aquí"
        error="Ya existe una cuenta con este correo."
      />,
    );
    const input = screen.getByLabelText("Correo electrónico");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Te escribiremos aquí Ya existe una cuenta con este correo.");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("switches with the keyboard", async () => {
    function Harness() {
      const [on, setOn] = useState(true);
      return (
        <Switch id="na-available" label="Contar en el disponible" checked={on} onCheckedChange={setOn} />
      );
    }
    const { container } = renderWithIntl(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Contar en el disponible" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(await axeViolations(container)).toEqual([]);
  });
});
