import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { Button } from "./button";
import { Switch } from "./switch";
import { TextField } from "./text-field";

const SIZES = ["lg", "lgFlow", "md", "compact", "chip", "icon", "iconCompact"] as const;
const VARIANTS = ["primary", "secondary", "ghost", "danger", "dangerGhost"] as const;

describe("atoms", () => {
  it.each(SIZES.flatMap((size) => VARIANTS.map((variant) => [size, variant] as const)))(
    "gives a %s %s button one radius, one height, one text size and no overridden class (no tailwind-merge)",
    (size, variant) => {
      renderWithIntl(
        <Button size={size} variant={variant}>
          Guardar
        </Button>,
      );
      const classes = screen.getByRole("button", { name: "Guardar" }).className.split(" ");
      expect(classes.filter((c) => c.startsWith("rounded-"))).toHaveLength(1);
      expect(classes.filter((c) => /^(h|size)-/.test(c))).toHaveLength(1);
      expect(classes.filter((c) => /^text-(xs|sm|base|lg|xl|2xl)$/.test(c))).toHaveLength(
        size.startsWith("icon") ? 0 : 1,
      );
      expect(classes.filter((c) => c.startsWith("bg-"))).toHaveLength(1);
      expect(classes.filter((c) => /^text-(accent|on-accent|ink|danger)$/.test(c))).toHaveLength(1);
    },
  );

  it("sizes the compact, chip and flowing buttons as the screens that override them did", () => {
    renderWithIntl(
      <>
        <Button size="compact">compact</Button>
        <Button size="chip">chip</Button>
        <Button size="lgFlow">flow</Button>
        <Button size="iconCompact">icon</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "compact" })).toHaveClass("h-11", "px-2", "text-sm");
    expect(screen.getByRole("button", { name: "chip" })).toHaveClass(
      "h-11",
      "rounded-full",
      "px-4",
      "text-sm",
    );
    expect(screen.getByRole("button", { name: "flow" })).toHaveClass("h-auto", "w-full", "px-6");
    expect(screen.getByRole("button", { name: "icon" })).toHaveClass("size-11");
  });

  it("marks an invalid field with one border colour and sizes a large field's text once", () => {
    renderWithIntl(
      <>
        <TextField id="a" label="Monto" large error="Falta el monto." />
        <TextField id="b" label="Nota" />
      </>,
    );
    const large = screen.getByLabelText("Monto");
    expect(large).toHaveClass("border-danger", "text-2xl", "font-semibold");
    expect(large).not.toHaveClass("border-field", "text-base");
    const plain = screen.getByLabelText("Nota");
    expect(plain).toHaveClass("border-field", "text-base");
    expect(plain).not.toHaveClass("border-danger", "text-2xl");
  });

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
