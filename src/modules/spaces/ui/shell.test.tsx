import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en, es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { AppShell } from "./app-shell";
import { JoinByLinkForm } from "./join-by-link-form";
import { NewSpaceForm } from "./new-space-form";
import { SpaceStanding } from "./space-standing";
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

  it("turns Inter on once a signed-in screen draws, so signing in from a visitor's page brings it (P299)", () => {
    delete document.documentElement.dataset.font;
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
        stacked
      >
        <h1>Ajustes</h1>
      </AppShell>,
    );
    expect(document.documentElement.dataset.font).toBe("inter");
  });

  it("starts with a link that skips to the screen's content, and the content takes the focus (#290)", async () => {
    // Audit pass 3, A17: a keyboard reached Registrar after twenty Tabs, with no way past the header.
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });

  it("shows the active space, the user menu and the navigation of the space", async () => {
    const { container } = renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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

  it("shows Saldos, then Más, after Movimientos and Registrar, in a shared space and in the personal one (P311 takes Plan out of the bar; P272 brings Saldos to Personal)", () => {
    const { unmount } = renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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
      // Ruling P310: Inicio is always the personal one.
      "/spaces/sp-personal",
      "/spaces/sp-household/transactions",
      "/spaces/sp-household/new",
      "/spaces/sp-household/balances",
      "/spaces/sp-household/more",
    ]);
    expect(within(nav).getByRole("link", { name: "Saldos" })).toBeInTheDocument();
    unmount();
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    // The personal space's bar has the same five slots as the board, so Registrar stays in the middle.
    expect(
      within(screen.getByRole("navigation", { name: "Principal" }))
        .getAllByRole("link")
        .map((l) => withoutQuery(l.getAttribute("href"))),
    ).toEqual([
      `/spaces/${spaces[0]!.id}`,
      `/spaces/${spaces[0]!.id}/transactions`,
      `/spaces/${spaces[0]!.id}/new`,
      `/spaces/${spaces[0]!.id}/balances`,
      `/spaces/${spaces[0]!.id}/more`,
    ]);
  });

  const openSwitcher = async () => {
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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

  it("lists no settings row under the spaces: the header's ⚙ opens them (ruling P311, amends P309)", async () => {
    const sheet = await openSwitcher();
    expect(within(sheet).queryByRole("link", { name: /Ajustes de|Configuración de/ })).toBeNull();
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/spaces/sp-personal", "/spaces/sp-household"]);
  });

  it("puts a ⚙ between the switcher and the profile that opens the active space's Configuración (ruling P311)", async () => {
    const { container } = renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[1]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    const header = screen.getByRole("banner");
    const gear = within(header).getByRole("link", { name: "Configuración de Household" });
    expect(gear).toHaveAttribute("href", "/spaces/sp-household/settings");
    expect(gear).toHaveClass("size-11");
    const profile = within(header).getByRole("button", { name: "Perfil de Ana" });
    expect(gear.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The eye that hid the amounts (P278) is gone.
    expect(within(header).queryByRole("button", { name: /Ocultar montos/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
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
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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
    expect(within(sheet).getByRole("link", { name: /^Personal/ })).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("link", { name: /^Personal/ })).toHaveTextContent("Solo tú");
    // Board B1 · 04: a shared space names its members once they are read, never the role.
    expect(within(sheet).getByRole("link", { name: /Household/ })).not.toHaveTextContent("Miembro");
    expect(within(sheet).getByRole("link", { name: /Household/ })).not.toHaveAttribute("aria-current");
    expect(within(sheet).getByRole("link", { name: /Household/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
  });

  it("draws a stacked screen with only its own header: no switcher, profile or navigation (ruling P272)", async () => {
    const { container } = renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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

  it("draws the switcher as a pill with the space's initial (B1 · 03)", () => {
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
        spaces={spaces}
        activeSpace={spaces[0]}
      >
        <h1>Inicio</h1>
      </AppShell>,
    );
    const pill = screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" });
    expect(pill).toHaveTextContent(/^PPersonal$/);
    expect(pill).toHaveClass("rounded-full", "border", "min-h-11");
  });

  describe("the space sheet's cards (B1 · 04, ruling P278)", () => {
    const balances = [
      {
        spaceId: "sp-household",
        memberId: "m-ana",
        net: { amount: "-12000000", currency: "COP" },
        members: [
          { memberId: "m-ana", name: "Ana" },
          { memberId: "m-juan", name: "Juan" },
          { memberId: "m-sofi", name: "Sofi" },
          { memberId: "m-pedro", name: "Pedro" },
        ],
        payments: [{ receivingMemberId: "m-juan", amount: { amount: "12000000", currency: "COP" } }],
      },
    ];
    const open = async (props: Partial<React.ComponentProps<typeof AppShell>> = {}) => {
      renderWithIntl(
        <AppShell
          me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
          spaces={spaces}
          activeSpace={spaces[0]}
          spaceStanding={SpaceStanding}
          {...props}
        >
          <h1>Inicio</h1>
        </AppShell>,
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }),
      );
      return screen.getByRole("dialog", { name: "Espacios" });
    };
    beforeEach(() => localStorage.clear());

    it("reads the person's balances when the sheet opens, not before", async () => {
      const onSwitcherOpen = vi.fn();
      renderWithIntl(
        <AppShell
          me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
          spaces={spaces}
          activeSpace={spaces[0]}
          onSwitcherOpen={onSwitcherOpen}
        >
          <h1>Inicio</h1>
        </AppShell>,
      );
      expect(onSwitcherOpen).not.toHaveBeenCalled();
      await userEvent.click(
        screen.getByRole("button", { name: "Espacio actual: Personal. Cambiar de espacio" }),
      );
      expect(onSwitcherOpen).toHaveBeenCalledTimes(1);
    });

    it("names a shared space's members and says what the person puts in there, in words", async () => {
      const sheet = await open({ myBalances: balances });
      const household = within(sheet).getByRole("link", { name: /Household/ });
      expect(household).toHaveTextContent("Ana, Juan, Sofi y Pedro");
      expect(household.textContent?.replace(/\s/g, " ")).toContain("Te toca poner$ 120.000");
      expect(household).not.toHaveTextContent("Miembro");
    });

    it("says what the person is owed there", async () => {
      const owed = [{ ...balances[0]!, net: { amount: "5000000", currency: "COP" }, payments: [] }];
      const sheet = await open({ myBalances: owed });
      expect(
        within(sheet)
          .getByRole("link", { name: /Household/ })
          .textContent?.replace(/\s/g, " "),
      ).toContain("Te toca recibir$ 50.000");
    });

    it("says nothing about money for a space where the person is al día", async () => {
      const settled = [{ ...balances[0]!, net: { amount: "0", currency: "COP" }, payments: [] }];
      const sheet = await open({ myBalances: settled });
      const household = within(sheet).getByRole("link", { name: /Household/ });
      expect(household).toHaveTextContent("Ana, Juan, Sofi y Pedro");
      expect(household).not.toHaveTextContent(/Te toca/);
    });

    it("marks the current space with a check on its card", async () => {
      const sheet = await open({ myBalances: balances });
      const current = within(sheet).getByRole("link", { name: /^Personal/ });
      expect(current).toHaveAttribute("aria-current", "true");
      expect(current).toHaveClass("border-accent");
      expect(current.querySelectorAll("svg")).toHaveLength(1);
      expect(
        within(sheet)
          .getByRole("link", { name: /Household/ })
          .querySelector("svg"),
      ).toBeNull();
    });

    it("always shows the balance: the eye that hid it left the header (ruling P311)", async () => {
      localStorage.setItem("hearth.hideAmounts.u-ana", "1");
      const sheet = await open({ myBalances: balances });
      const household = within(sheet).getByRole("link", { name: /Household/ });
      expect(household).toHaveTextContent("Te toca poner");
      expect(household).not.toHaveTextContent("••••••");
      expect(household).toHaveTextContent("120.000");
    });

    it("joins the names in English with and", () => {
      expect(en.shell.space.members).toBe("{others} and {last}");
      expect(es.shell.space.members).toBe("{others} y {last}");
    });
  });

  it("makes the chosen space the active one in the shell", () => {
    renderWithIntl(
      <AppShell
        me={{ id: "u-ana", name: "Ana", email: "ana@example.com", locale: "es" }}
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
