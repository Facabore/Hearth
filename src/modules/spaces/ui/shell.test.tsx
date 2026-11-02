import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { AppShell } from "./app-shell";
import { JoinByLinkForm } from "./join-by-link-form";
import { NewSpaceForm } from "./new-space-form";
import type { SpaceFlows } from "./space-switcher";

/** The switcher's flows as the app passes them (the SPA loads them on demand; here they are at hand). */
const Flows: SpaceFlows = ({ flow, onDone }) =>
  flow === "create" ? <NewSpaceForm onCreated={onDone} /> : <JoinByLinkForm onOpened={onDone} />;

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const navigation = vi.hoisted(() => ({ pathname: "/spaces/sp-personal", search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = "/spaces/sp-personal";
  navigation.search = "";
});
const withoutQuery = (href: string | null) => href?.split("?")[0];

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
    // Issue #172: the form comes back to the screen it was opened from.
    expect(within(nav).getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute(
      "href",
      `/spaces/sp-personal/new?returnTo=${encodeURIComponent("/spaces/sp-personal")}`,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows Plan, then Saldos in a shared space, after Movimientos and Registrar, and no Saldos in the personal one (rulings P160, P200)", () => {
    const { unmount } = renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[1]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => withoutQuery(l.getAttribute("href"))),
    ).toEqual([
      "/spaces/sp-household",
      "/spaces/sp-household/transactions",
      "/spaces/sp-household/new",
      "/spaces/sp-household/plan",
      "/spaces/sp-household/balances",
    ]);
    expect(within(nav).getByRole("link", { name: "Saldos" })).toBeInTheDocument();
    unmount();
    renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: "Saldos" })).not.toBeInTheDocument();
  });

  const openSwitcher = async () => {
    renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
        spaceFlows={Flows}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }),
    );
    return screen.getByRole("dialog", { name: "Espacios" });
  };

  it("ends the space sheet with Crear un espacio compartido and Unirme con un enlace de invitación, under a divider (B1 · 04)", async () => {
    const sheet = await openSwitcher();
    const create = within(sheet).getByRole("button", { name: "Crear un espacio compartido" });
    const join = within(sheet).getByRole("button", { name: "Unirme con un enlace de invitación" });
    expect(within(sheet).getByRole("separator")).toBeInTheDocument();
    for (const action of [create, join]) {
      expect(action).toHaveClass("min-h-14");
      expect(action.querySelector("svg")).not.toBeNull();
    }
    expect(within(sheet).getAllByRole("button").at(-1)).toBe(join);
  });

  it("opens Crear un espacio compartido as a sheet over the switcher, with a way back to the spaces (E9-05 · 07)", async () => {
    const sheet = await openSwitcher();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear un espacio compartido" }));
    const create = screen.getByRole("dialog", { name: "Crear un espacio compartido" });
    expect(await within(create).findByLabelText("Nombre")).toBeInTheDocument();
    expect(within(create).getByRole("combobox", { name: "Moneda" })).toHaveValue("COP");
    expect(within(create).getByRole("button", { name: "Crear espacio" })).toBeInTheDocument();
    const back = within(create).getByRole("button", { name: "Volver" });
    expect(back).toHaveClass("size-12");
    await userEvent.click(back);
    expect(screen.getByRole("dialog", { name: "Espacios" })).toBeInTheDocument();
  });

  it("joins with a pasted invitation link: Ver invitación opens the invitation (Pantallas nuevas · 11)", async () => {
    const sheet = await openSwitcher();
    await userEvent.click(within(sheet).getByRole("button", { name: "Unirme con un enlace de invitación" }));
    const join = screen.getByRole("dialog", { name: "Unirme a un espacio" });
    const field = await within(join).findByLabelText("Pega el enlace");
    expect(field).toHaveAccessibleDescription("También puedes abrir el enlace directamente desde el chat.");
    await userEvent.type(field, " https://hearth.example/invitations/AbC-123_x ");
    await userEvent.click(within(join).getByRole("button", { name: "Ver invitación" }));
    expect(router.push).toHaveBeenCalledWith("/invitations/AbC-123_x");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a pasted claim link too, and refuses anything else under the field", async () => {
    const sheet = await openSwitcher();
    await userEvent.click(within(sheet).getByRole("button", { name: "Unirme con un enlace de invitación" }));
    const join = screen.getByRole("dialog", { name: "Unirme a un espacio" });
    const field = await within(join).findByLabelText("Pega el enlace");
    await userEvent.type(field, "https://example.com/otra-cosa");
    await userEvent.click(within(join).getByRole("button", { name: "Ver invitación" }));
    expect(field).toHaveAccessibleDescription(
      "También puedes abrir el enlace directamente desde el chat. Ese enlace no es una invitación de Hearth. Revisa que esté completo.",
    );
    expect(router.push).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, "https://hearth.example/claims/XyZ");
    await userEvent.click(within(join).getByRole("button", { name: "Ver invitación" }));
    expect(router.push).toHaveBeenCalledWith("/claims/XyZ");
  });

  it("goes back from Unirme a un espacio to the spaces", async () => {
    const sheet = await openSwitcher();
    await userEvent.click(within(sheet).getByRole("button", { name: "Unirme con un enlace de invitación" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Unirme a un espacio" })).getByRole("button", {
        name: "Volver",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Espacios" })).toBeInTheDocument();
  });

  it("words the switcher's actions in tú in Spanish and in plain English", () => {
    expect(es.shell.space.join).toBe("Unirme con un enlace de invitación");
    expect(es.spaces.join.hint).toBe("También puedes abrir el enlace directamente desde el chat.");
    expect(es.spaces.join.link).toBe("Pega el enlace");
    expect(en.shell.space.join).toBe("Join with an invitation link");
    expect(en.spaces.join.hint).toBe("You can also open the link straight from the chat.");
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

  it("draws a stacked screen with only its own header: no switcher, profile or navigation (ruling P272)", async () => {
    const { container } = renderWithIntl(
      <AppShell
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[1]}
        stacked
      >
        <a href="/spaces/sp-household">Volver</a>
        <h1>Miembros</h1>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Miembros" }));
    expect(screen.queryByRole("button", { name: /Cambiar de espacio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Perfil de Ana" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
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
