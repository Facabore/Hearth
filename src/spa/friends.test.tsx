import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendDto, FriendRequestsDto } from "@/modules/balances/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { cop, friendDto, meDto, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";
import { forgetFriendLink } from "./spaces/friend-link";

const KEY = "hearth.friendLink";
const AMIGOS = "/spaces/sp-personal/balances";
const CARLOS = {
  id: "fr-carlos",
  handle: "carlosr",
  displayName: "Carlos Ruiz",
  createdAt: "2026-11-17T10:00:00.000Z",
};
const DIRECT = (id: string, name: string) => spaceDto({ id, name, kind: "DIRECT", role: "OWNER" });

/** Ana and her Amigos over a fake /api/v1 that keeps what each write changed. */
const server = ({ signedIn = true }: { signedIn?: boolean } = {}) => {
  const state = {
    session: signedIn,
    spaces: [spaceDto(), DIRECT("sp-mama", "Mamá")] as SpaceDto[],
    friends: [friendDto({ net: cop(0) })] as FriendDto[],
    requests: { incoming: [CARLOS], outgoing: [] } as FriendRequestsDto,
  };
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () =>
      state.session ? jsonResponse(meDto({ handle: "ana" })) : problemResponse(401, "Unauthenticated"),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "POST /api/v1/auth/sign-up": () => ((state.session = true), jsonResponse({ user: meDto() }, 201)),
    "POST /api/v1/auth/sign-in": () => ((state.session = true), jsonResponse({ user: meDto(), token: "t" })),
    "GET /api/v1/spaces": () => jsonResponse({ items: state.spaces }),
    "GET /api/v1/me/friends": () => jsonResponse({ items: state.friends }),
    "GET /api/v1/me/friend-requests": () => jsonResponse(state.requests),
    "GET /api/v1/users/by-handle/{handle}": (_, { handle }) =>
      handle === "analopez"
        ? jsonResponse({ handle, displayName: "Ana López" })
        : problemResponse(404, "UserNotFound"),
    "POST /api/v1/me/friend-requests/{requestId}/accept": () => {
      state.requests = { incoming: [], outgoing: [] };
      state.spaces = [...state.spaces, DIRECT("sp-carlos", "Carlos Ruiz")];
      state.friends = [
        ...state.friends,
        friendDto({
          spaceId: "sp-carlos",
          me: { memberId: "m-ana-carlos" },
          other: { memberId: "m-carlos", kind: "USER", displayName: "Carlos Ruiz", nickname: null },
          name: "Carlos Ruiz",
          net: cop(0),
          lastMovement: null,
        }),
      ];
      return jsonResponse({ spaceId: "sp-carlos" });
    },
    "POST /api/v1/me/friends": async (request) => {
      const { displayName } = (await request.json()) as { displayName: string };
      const added = friendDto({
        spaceId: "sp-luis",
        me: { memberId: "m-ana-luis" },
        other: { memberId: "m-luis", kind: "GUEST", displayName, nickname: null },
        name: displayName,
        net: cop(0),
        lastMovement: null,
      });
      state.spaces = [...state.spaces, DIRECT("sp-luis", displayName)];
      state.friends = [...state.friends, added];
      return jsonResponse(added, 201);
    },
    "DELETE /api/v1/me/friends/{spaceId}": (_, { spaceId }) => {
      state.spaces = state.spaces.filter((space) => space.id !== spaceId);
      state.friends = state.friends.filter((friend) => friend.spaceId !== spaceId);
      return new Response(null, { status: 204 });
    },
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/balances": () => jsonResponse({ members: [] }),
    "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => jsonResponse({ suggestions: [] }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
    "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": (_, { memberId }) =>
      jsonResponse({ memberId, from: null, to: null, opening: cop(0), closing: cop(0), entries: [] }),
  };
  return { routes, state };
};

const count = (requests: readonly Request[], method: string, path: RegExp) =>
  requests.filter((r) => r.method === method && path.test(new URL(r.url).pathname)).length;

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
  forgetFriendLink();
});
afterEach(() => vi.restoreAllMocks());

describe('Amigos\' requests, adding and removing (ruling P339, boards "Amigos" and "Agregar amigo")', () => {
  it("accepts a request: the requests, Amigos and the spaces are read again", async () => {
    const { routes } = server();
    const spa = renderSpa(AMIGOS, routes);
    const requests = await screen.findByRole("region", { name: "Solicitudes · 1" });
    const before = count(spa.requests, "GET", /\/me\/friend-requests$/);
    await userEvent.click(within(requests).getByRole("button", { name: "Aceptar a Carlos Ruiz" }));
    expect(await screen.findByRole("link", { name: /Carlos Ruiz/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/friends/sp-carlos",
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: /Solicitudes/ })).toBeNull());
    expect(count(spa.requests, "GET", /\/me\/friend-requests$/)).toBeGreaterThan(before);
  });

  it("adds someone who does not use Hearth and opens their screen", async () => {
    const { routes } = server();
    const spa = renderSpa(AMIGOS, routes);
    await userEvent.click(await screen.findByRole("button", { name: "Agregar amigo" }));
    const sheet = await screen.findByRole("dialog", { name: "Agregar amigo" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "No usa Hearth" }), "Luis");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Luis" })).toBeVisible();
    expect(spa.location()).toBe("/spaces/sp-personal/friends/sp-luis");
  });

  it("removes a friend the viewer is even with and goes back to Amigos without them", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-personal/friends/sp-mama", routes);
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar de Amigos" }));
    const sheet = await screen.findByRole("dialog", { name: "Eliminar a Mamá" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Eliminar de Amigos" }));
    await waitFor(() => expect(spa.location()).toBe(AMIGOS));
    expect(await screen.findByRole("heading", { level: 1, name: "Amigos" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Mamá/ })).toBeNull();
    expect(count(spa.requests, "DELETE", /\/me\/friends\/sp-mama$/)).toBe(1);
  });
});

describe("a friend link, /f/<handle> (ruling P339, S6)", () => {
  it("opens a signed-in person's Agregar amigo with the @ filled in, once", async () => {
    const { routes } = server();
    const spa = renderSpa("/f/AnaLopez", routes);
    const sheet = await screen.findByRole("dialog", { name: "Agregar amigo" });
    expect(spa.location()).toBe(AMIGOS);
    expect(within(sheet).getByRole("textbox", { name: "Usa Hearth" })).toHaveValue("analopez");
    expect(await within(sheet).findByText("Ana López")).toBeVisible();
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it("keeps a visitor's @ across the sign-up, then opens Agregar amigo with it and forgets it", async () => {
    const { routes } = server({ signedIn: false });
    const spa = renderSpa("/f/analopez", routes);
    expect(await screen.findByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
    expect(spa.location()).toBe("/sign-up");
    expect(localStorage.getItem(KEY)).toBe("analopez");
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.type(screen.getByLabelText("Confirmar contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const sheet = await screen.findByRole("dialog", { name: "Agregar amigo" });
    expect(spa.location()).toBe(AMIGOS);
    expect(within(sheet).getByRole("textbox", { name: "Usa Hearth" })).toHaveValue("analopez");
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
  });

  it("keeps a visitor's @ across a sign-in into an account they already have", async () => {
    const { routes } = server({ signedIn: false });
    const spa = renderSpa("/f/analopez", routes);
    await userEvent.click(await screen.findByRole("link", { name: "Inicia sesión" }));
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const sheet = await screen.findByRole("dialog", { name: "Agregar amigo" });
    expect(spa.location()).toBe(AMIGOS);
    expect(within(sheet).getByRole("textbox", { name: "Usa Hearth" })).toHaveValue("analopez");
  });

  it("signs up without a link as before: home, and no Agregar amigo", async () => {
    const { routes } = server({ signedIn: false });
    const spa = renderSpa("/sign-up", routes);
    await userEvent.type(await screen.findByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.type(screen.getByLabelText("Confirmar contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
  });
});
