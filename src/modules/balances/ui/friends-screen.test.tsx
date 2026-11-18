import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, friendDto, money, normalized } from "../../../../tests/support/ui/dto";
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
      "Te deben 525.000 COP · Debes 120.000 COP",
    );
    expect(rows()).toEqual([
      {
        text: "MMamáNo usa Hearth · Préstamo · 12 mar 2025Te debe500.000 COP",
        href: "/spaces/sp-personal/friends/sp-mama",
      },
      { text: "JJuan@juanp · Almuerzo · AyerTe debe25.000 COP", href: "/spaces/sp-personal/friends/sp-juan" },
      {
        text: "JLJhon LópezPréstamo · 3 octLe debes120.000 COP",
        href: "/spaces/sp-personal/friends/sp-jhon",
      },
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
      "You're owed 525.000 COP · You owe 120.000 COP",
    );
  });
});

describe('Amigos per currency (ruling P342, board "Amigos · una deuda por moneda")', () => {
  const PER_CURRENCY = [
    friendDto({ nets: [cop(500_000), money(50, "USD"), money(60, "EUR")] }),
    friendDto({
      spaceId: "sp-juan",
      other: { memberId: "m-juan", kind: "USER", displayName: "Juan", nickname: null },
      name: "Juan",
      net: cop(25_000),
      nets: [cop(25_000)],
      lastMovement: null,
    }),
    friendDto({
      spaceId: "sp-brother",
      other: { memberId: "m-brother", kind: "USER", displayName: "Brother", nickname: null },
      name: "Brother",
      net: cop(0),
      nets: [money(120, "USD")],
      lastMovement: null,
    }),
    friendDto({
      spaceId: "sp-jhon",
      other: { memberId: "m-jhon", kind: "USER", displayName: "Jhon López", nickname: null },
      name: "Jhon López",
      net: cop(-120_000),
      nets: [cop(-120_000), money(30, "USD")],
      lastMovement: null,
    }),
    friendDto({
      spaceId: "sp-ana",
      other: { memberId: "m-ana2", kind: "USER", displayName: "Ana", nickname: null },
      name: "Ana",
      net: cop(0),
      nets: [],
      lastMovement: null,
    }),
  ];

  it("stacks each person's debts by currency under their word, and totals each currency apart", async () => {
    const { container } = view({ friends: PER_CURRENCY });
    expect(normalized(screen.getByText(/^Te deben/).textContent)).toBe(
      "Te deben 525.000 COP · 200 USD · 60 EUR · Debes 120.000 COP",
    );
    expect(rows().map((row) => row.text)).toEqual([
      "MMamáNo usa Hearth · Préstamo · 12 mar 2025Te debe500.000 COP50 USD60 EUR",
      "JJuanSin movimientosTe debe25.000 COP",
      "BBrotherSin movimientosTe debe120 USD",
      "JLJhon LópezSin movimientosLe debes120.000 COPTe debe30 USD",
      "AAnaSin movimientosAl día",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("gives a mixed person's every line its own word and tone, never colour alone", () => {
    view({ friends: PER_CURRENCY });
    const jhon = screen.getByRole("link", { name: /Jhon López/ });
    expect(within(jhon).getByText("Le debes")).toHaveClass("text-owe-ink");
    expect(within(jhon).getByText(/120\.000/)).toHaveClass("text-owe-ink");
    expect(within(jhon).getByText("Te debe")).toHaveClass("text-accent");
    expect(within(jhon).getByText(/30/)).toHaveClass("text-accent");
    expect(within(jhon).getByText(/30/)).toHaveAttribute("data-amount");
  });

  it("speaks English", () => {
    view({ friends: PER_CURRENCY }, "en");
    expect(normalized(screen.getByText(/^You're owed/).textContent)).toBe(
      "You're owed 525.000 COP · 200 USD · 60 EUR · You owe 120.000 COP",
    );
  });

  it("sums Inicio's line per currency from each person's debts", () => {
    renderWithIntl(
      <FriendsLine friends={PER_CURRENCY} href="/spaces/sp-personal/balances" formats={BUILT_IN_FORMATS} />,
    );
    expect(normalized(screen.getByRole("link").textContent)).toBe(
      "Amigos · te deben 525.000 COP + 200 USD + 60 EUR · debes 120.000 COP›",
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
    expect(normalized(link.textContent)).toBe("Amigos · te deben 975.000 COP›");
    expect(link).toHaveAttribute("href", "/spaces/sp-personal/balances");
  });

  it("says what she owes, both ways when both, and in English", () => {
    const { unmount } = line([friendDto({ net: cop(-120_000) })]);
    expect(normalized(screen.getByRole("link").textContent)).toBe("Amigos · debes 120.000 COP›");
    unmount();
    const both = line([friendDto(), friendDto({ spaceId: "sp-jhon", net: cop(-120_000) })]);
    expect(normalized(screen.getByRole("link").textContent)).toBe(
      "Amigos · te deben 500.000 COP · debes 120.000 COP›",
    );
    both.unmount();
    line([friendDto()], "en");
    expect(normalized(screen.getByRole("link").textContent)).toBe("Friends · you're owed 500.000 COP›");
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
