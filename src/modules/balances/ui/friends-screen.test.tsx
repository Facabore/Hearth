import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, friendDto, normalized } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { FriendsLine } from "./friends-line";
import { FriendsScreen } from "./friends-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const TODAY = "2026-11-16";

const view = (props: Partial<Parameters<typeof FriendsScreen>[0]> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <FriendsScreen
      spaceId="sp-personal"
      friends={[
        friendDto(),
        friendDto({
          spaceId: "sp-juan",
          other: {
            memberId: "m-juan",
            kind: "USER",
            displayName: "Juan Pérez",
            nickname: "Juan",
            handle: "juanp",
          },
          name: "Juan",
          net: cop(25_000),
          lastMovement: {
            transactionId: "t-lunch",
            date: "2026-11-15",
            description: "Almuerzo",
            type: "EXPENSE",
          },
        }),
        friendDto({
          spaceId: "sp-jhon",
          other: { memberId: "m-jhon", kind: "USER", displayName: "Jhon López", nickname: null },
          name: "Jhon López",
          net: cop(-120_000),
          lastMovement: {
            transactionId: "t-jhon",
            date: "2026-10-03",
            description: "Préstamo",
            type: "EXPENSE",
          },
        }),
        friendDto({
          spaceId: "sp-sara",
          other: { memberId: "m-sara", kind: "USER", displayName: "Sara", nickname: null },
          name: "Sara",
          net: cop(0),
          lastMovement: null,
        }),
      ]}
      formats={BUILT_IN_FORMATS}
      today={TODAY}
      {...(props as object)}
    />,
    { locale },
  );

const rows = () =>
  within(screen.getByRole("list", { name: "Amigos" }))
    .getAllByRole("link")
    .map((link) => ({ text: normalized(link.textContent), href: link.getAttribute("href") }));

describe('Amigos (ruling P338, board "Amigos · cada persona con su saldo")', () => {
  it("lists each person with their last movement and who owes whom, in words and with the totals", async () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1, name: "Amigos" })).toBeInTheDocument();
    expect(normalized(screen.getByText(/^Te deben/).textContent)).toBe(
      "Te deben $ 525.000 · Debes $ 120.000",
    );
    expect(rows()).toEqual([
      {
        text: "MMamáNo usa Hearth · Préstamo · 12 mar 2025Te debe$ 500.000",
        href: "/spaces/sp-personal/friends/sp-mama",
      },
      { text: "JJuan@juanp · Almuerzo · AyerTe debe$ 25.000", href: "/spaces/sp-personal/friends/sp-juan" },
      { text: "JLJhon LópezPréstamo · 3 octLe debes$ 120.000", href: "/spaces/sp-personal/friends/sp-jhon" },
      { text: "SSaraSin movimientosAl día", href: "/spaces/sp-personal/friends/sp-sara" },
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("never shows who owes by color alone: the warm row says Le debes beside its amount", () => {
    view();
    const jhon = screen.getByRole("link", { name: /Jhon López/ });
    expect(within(jhon).getByText("Le debes")).toBeInTheDocument();
    expect(within(jhon).getByText(/120\.000/)).toHaveAttribute("data-amount");
  });

  it("teaches where people come from when there is no one yet", async () => {
    const { container } = view({ friends: [] });
    expect(
      screen.getByText("Cuando compartas un gasto o un préstamo con alguien, aparece aquí."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Te deben/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("speaks English", () => {
    view({}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Friends" })).toBeInTheDocument();
    expect(normalized(screen.getByText(/^You're owed/).textContent)).toBe(
      "You're owed $ 525.000 · You owe $ 120.000",
    );
  });
});

describe('Inicio\'s line to Amigos (ruling P338, board "Inicio · Personal: Amigos en la barra")', () => {
  const line = (friends: Parameters<typeof FriendsLine>[0]["friends"], locale: "es" | "en" = "es") =>
    renderWithIntl(
      <FriendsLine friends={friends} href="/spaces/sp-personal/balances" formats={BUILT_IN_FORMATS} />,
      { locale },
    );

  it("says what the people owe the person and opens Amigos", () => {
    line([friendDto(), friendDto({ spaceId: "sp-juan", net: cop(475_000) })]);
    const link = screen.getByRole("link");
    expect(normalized(link.textContent)).toBe("Amigos · te deben $ 975.000›");
    expect(link).toHaveAttribute("href", "/spaces/sp-personal/balances");
  });

  it("says what she owes, both ways when both, and in English", () => {
    const { unmount } = line([friendDto({ net: cop(-120_000) })]);
    expect(normalized(screen.getByRole("link").textContent)).toBe("Amigos · debes $ 120.000›");
    unmount();
    const both = line([friendDto(), friendDto({ spaceId: "sp-jhon", net: cop(-120_000) })]);
    expect(normalized(screen.getByRole("link").textContent)).toBe(
      "Amigos · te deben $ 500.000 · debes $ 120.000›",
    );
    both.unmount();
    line([friendDto()], "en");
    expect(normalized(screen.getByRole("link").textContent)).toBe("Friends · you're owed $ 500.000›");
  });

  it("draws nothing while everyone is al día", () => {
    const { container } = line([friendDto({ net: cop(0) })]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Amigos' requests and Agregar amigo (ruling P339, board 'Amigos · solicitudes y eliminar')", () => {
  const CARLOS = {
    id: "fr-carlos",
    handle: "carlosr",
    displayName: "Carlos Ruiz",
    createdAt: "2026-11-17T10:00:00.000Z",
  };
  const LUCIA = {
    id: "fr-lucia",
    handle: "lucia",
    displayName: "Lucía",
    createdAt: "2026-11-16T10:00:00.000Z",
  };
  const requests = { incoming: [CARLOS], outgoing: [LUCIA] };

  it("lists the requests received first, with Aceptar and Rechazar, then the ones sent, before the friends", async () => {
    const { container } = view({ requests });
    const section = screen.getByRole("region", { name: "Solicitudes · 2" });
    const items = within(section).getAllByRole("listitem");
    expect(items.map((item) => normalized(item.textContent))).toEqual([
      "CRCarlos Ruiz@carlosrAceptarRechazar",
      "LLucía@lucia · Solicitud enviada",
    ]);
    expect(within(items[1]!).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Tus amigos · 4")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("accepts a request and reads Amigos again", async () => {
    const { api, requests: sent } = fakeApi({
      "POST /api/v1/me/friend-requests/{requestId}/accept": () => jsonResponse({ spaceId: "sp-carlos" }),
    });
    view({ requests, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar a Carlos Ruiz" }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /api/v1/me/friend-requests/fr-carlos/accept",
    ]);
  });

  it("rejects a request and reads Amigos again", async () => {
    const { api, requests: sent } = fakeApi({
      "POST /api/v1/me/friend-requests/{requestId}/reject": () => new Response(null, { status: 204 }),
    });
    view({ requests, api });
    await userEvent.click(screen.getByRole("button", { name: "Rechazar a Carlos Ruiz" }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /api/v1/me/friend-requests/fr-carlos/reject",
    ]);
  });

  it("opens Agregar amigo from the header's +, and at once with the @ a friend link carried", async () => {
    const { unmount } = view();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Agregar amigo" }));
    expect(await screen.findByRole("dialog", { name: "Agregar amigo" })).toBeInTheDocument();
    unmount();
    view({ addHandle: "analopez", api: fakeApi({}).api });
    const dialog = await screen.findByRole("dialog", { name: "Agregar amigo" });
    expect(within(dialog).getByRole("textbox", { name: "Usa Hearth" })).toHaveValue("analopez");
  });

  it("keeps the friends' list as it was without requests", () => {
    view();
    expect(screen.queryByRole("region", { name: /Solicitudes/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tus amigos/)).not.toBeInTheDocument();
  });
});
