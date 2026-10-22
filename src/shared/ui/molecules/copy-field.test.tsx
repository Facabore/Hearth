import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CopyField } from "./copy-field";

const URL_ = "https://hearth.example/invitations/AbC";
afterEach(() => vi.unstubAllGlobals());

describe("CopyField (ruling P181)", () => {
  it("copies the URL and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { container } = renderWithIntl(<CopyField id="link" label="Enlace de invitación" value={URL_} />);
    expect(screen.getByLabelText("Enlace de invitación")).toHaveValue(URL_);
    expect(screen.getByLabelText("Enlace de invitación")).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(screen.getByRole("status")).toHaveTextContent("Copiado");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("selects the URL and asks to copy it by hand when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    renderWithIntl(<CopyField id="link" label="Enlace de invitación" value={URL_} />);
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "No se pudo copiar: selecciona el enlace y cópialo.",
    );
    const field = screen.getByLabelText<HTMLInputElement>("Enlace de invitación");
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, URL_.length]);
  });
});
