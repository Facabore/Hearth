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
});
