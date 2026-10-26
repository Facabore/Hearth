import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ChoiceGroup } from "./choice-group";
import { ProblemNotice } from "./problem-notice";
import { Sheet } from "./sheet";

describe("molecules", () => {
  it("loads a sheet's panel when it first opens and renders nothing while it is closed (ruling P134)", async () => {
    vi.resetModules();
    const { Sheet: FreshSheet } = await import("./sheet"); // a fresh module: its panel is not loaded yet
    const view = renderWithIntl(
      <FreshSheet open={false} onOpenChange={vi.fn()} title="Espacios">
        <p>Personal</p>
      </FreshSheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(
      <FreshSheet open onOpenChange={vi.fn()} title="Espacios">
        <p>Personal</p>
      </FreshSheet>,
    );
    expect(await screen.findByRole("dialog", { name: "Espacios" })).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("lets a very long unbroken title and description wrap inside the sheet", async () => {
    renderWithIntl(
      <Sheet open onOpenChange={vi.fn()} title={"M".repeat(100)} description={"W".repeat(80)}>
        <p>Contenido</p>
      </Sheet>,
    );
    expect(await screen.findByRole("heading", { name: "M".repeat(100) })).toHaveClass(
      "min-w-0",
      "[overflow-wrap:anywhere]",
    );
    expect(screen.getByText("W".repeat(80))).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("opens a sheet that was mounted before another sheet loaded the panel (ruling P134)", async () => {
    vi.resetModules();
    const { Sheet: FreshSheet } = await import("./sheet");
    const both = (first: boolean, second: boolean) => (
      <>
        <FreshSheet open={first} onOpenChange={vi.fn()} title="Categoría">
          <p>Comida</p>
        </FreshSheet>
        <FreshSheet open={second} onOpenChange={vi.fn()} title="Cuenta">
          <p>Bancolombia</p>
        </FreshSheet>
      </>
    );
    const view = renderWithIntl(both(false, false));
    view.rerender(both(true, false));
    expect(await screen.findByRole("dialog", { name: "Categoría" })).toBeInTheDocument();
    view.rerender(both(false, true));
    expect(await screen.findByRole("dialog", { name: "Cuenta" })).toBeInTheDocument();
  });

  it("opens a sheet named by its title, closes it with Escape and with its labelled close button", async () => {
    const onOpenChange = vi.fn();
    renderWithIntl(
      <Sheet open onOpenChange={onOpenChange} title="Espacios">
        <p>Personal</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Espacios" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("paints the sheet and its scrim above the bottom navigation, pads for the safe area and scrolls only its body (S1, S7)", () => {
    renderWithIntl(
      <Sheet open onOpenChange={vi.fn()} title="Espacios">
        <p>Personal</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Espacios" });
    // The bottom navigation is z-10: both layers sit above it.
    expect(dialog).toHaveClass("z-50", "max-h-[90dvh]", "pb-[max(1rem,env(safe-area-inset-bottom))]");
    expect(document.querySelector("[data-state='open'].bg-scrim")).toHaveClass("z-50");
    const body = screen.getByText("Personal").parentElement!;
    expect(body).toHaveClass("min-h-0", "overflow-y-auto", "overscroll-contain");
  });

  it("moves through a choice group with the arrow keys and skips disabled choices", async () => {
    function Harness() {
      const [value, setValue] = useState<"DMY" | "MDY" | "YMD">("DMY");
      return (
        <ChoiceGroup
          label="Fecha"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "DMY", label: "16/10/2026" },
            { value: "MDY", label: "10/16/2026", disabled: true },
            { value: "YMD", label: "2026/10/16" },
          ]}
        />
      );
    }
    const { container } = renderWithIntl(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Fecha" });
    expect(screen.getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    screen.getByRole("radio", { name: "16/10/2026" }).focus();
    // Radix moves focus in a timeout after keydown and selects only while the arrow is still down, as in a browser.
    await userEvent.keyboard("{ArrowRight>}");
    await userEvent.keyboard("{/ArrowRight}");
    expect(screen.getByRole("radio", { name: "2026/10/16" })).toBeChecked();
    expect(group).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("announces a problem with its message and reference", () => {
    renderWithIntl(
      <ProblemNotice problem={{ code: "Nope", status: 500, requestId: "req-7", errors: [], field: null }} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal. Intenta de nuevo.");
    expect(alert).toHaveTextContent("Referencia: req-7");
  });

  it("adds a detail line under a known problem's message (ruling P163)", () => {
    renderWithIntl(
      <ProblemNotice
        problem={{ code: "OutstandingBalance", status: 409, requestId: "r", errors: [], field: null }}
        detail="Saldo pendiente: $ 100.000"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Para salir del espacio, quitar a alguien o archivar el espacio, los saldos tienen que quedar en cero. Registra los pagos que falten para quedar al día y vuelve a intentarlo.",
    );
    expect(alert).toHaveTextContent("Saldo pendiente: $ 100.000");
  });
});
