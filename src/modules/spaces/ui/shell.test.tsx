import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { AppShell } from "./app-shell";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/sp-personal" }));

describe("app shell (HU-E9-01)", () => {
  const spaces = [
    { id: "sp-personal", name: "Personal", kind: "PERSONAL", role: "OWNER" },
    { id: "sp-household", name: "Household", kind: "SHARED", role: "MEMBER" },
  ] as const;

  it("shows the active space, the user menu and the navigation of the space", async () => {
    const { container } = renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(
      screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perfil de Ana" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Movimientos" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    expect(within(nav).getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/new",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists every current space in the switcher and links to the chosen one", async () => {
    renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Espacios" });
    expect(within(sheet).getByRole("link", { name: /Personal/ })).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("link", { name: /Personal/ })).toHaveTextContent("Solo tú");
    expect(within(sheet).getByRole("link", { name: /Household/ })).toHaveTextContent("Miembro");
    expect(within(sheet).getByRole("link", { name: /Household/ })).not.toHaveAttribute("aria-current");
    expect(within(sheet).getByRole("link", { name: /Household/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
  });

  it("makes the chosen space the active one in the shell", () => {
    renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[1]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(
      screen.getByRole("button", { name: "Espacio actual: Household. Cambiar de espacio" }),
    ).toBeInTheDocument();
  });
});
