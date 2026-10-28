import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import type { InvitationDto, SpaceDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  cop,
  householdSpace,
  invitationDto,
  meDto,
  memberDto,
  octoberPage,
  spaceDto,
  transactionDto,
} from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

const HOUSEHOLD = "/spaces/sp-household";
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

/** Ana's Household with Juan, who owes her 100,000 COP, over a fake /api/v1 that keeps what each write changed. */
const server = (signedIn = true) => {
  const state = {
    spaces: [spaceDto(), householdSpace()] as SpaceDto[],
    invitations: [invitationDto()] as InvitationDto[],
    owed: 100_000,
  };
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => (signedIn ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated")),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces": () => jsonResponse({ items: state.spaces }),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto(), JUAN] }),
    "GET /api/v1/spaces/{spaceId}/balances": () =>
      jsonResponse({
        members: [
          { memberId: "m-ana", net: cop(state.owed) },
          { memberId: "m-juan", net: cop(-state.owed) },
        ],
      }),
    "GET /api/v1/spaces/{spaceId}/balances/suggestions": () =>
      jsonResponse({
        suggestions: state.owed
          ? [{ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(state.owed) }]
          : [],
      }),
    "POST /api/v1/spaces/{spaceId}/settlements": () => {
      state.owed = 0;
      return jsonResponse(transactionDto({ id: "t-settle", type: "SETTLEMENT" }), 201);
    },
    "GET /api/v1/spaces/{spaceId}/invitations": () => jsonResponse({ items: state.invitations }),
    "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": () => {
      state.invitations = [];
      return new Response(null, { status: 204 });
    },
    "GET /api/v1/spaces/{spaceId}/accounts": (_, { spaceId }) =>
      jsonResponse({
        items: spaceId === "sp-personal" ? [accountDto({ id: "a-bank", name: "Bancolombia" })] : [],
        totals: { available: cop(0), netWorth: cop(0) },
      }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [OCTOBER] }),
    "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": (_, { memberId }) =>
      jsonResponse({
        memberId,
        from: "2026-10-01",
        to: "2026-10-31",
        opening: cop(0),
        closing: cop(0),
        entries: [],
      }),
    "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] }),
    "GET /api/v1/invitations/{token}": () =>
      jsonResponse({
        kind: "LINK",
        spaceName: "Trip",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: "2026-10-31T12:00:00.000Z",
        invitedBy: "Juan",
      }),
    "POST /api/v1/invitations/{token}/accept": () => {
      const trip = householdSpace({ id: "sp-trip", name: "Trip", role: "MEMBER" });
      state.spaces = [...state.spaces, trip];
      return jsonResponse(trip);
    },
  };
  return { routes, state };
};

const count = (requests: Request[], method: string, path: RegExp) =>
  requests.filter((r) => r.method === method && path.test(new URL(r.url).pathname)).length;

const named = (text: string) => new RegExp(`^${text.replace(/[.()$]/g, "\\$&").replace(/ /g, "\\s")}$`);

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("shared spaces in the SPA (slice 4 of #199, ADR 0006)", () => {
  it("lists the members and, for someone who may invite, the pending invitations; revoking one reads only the members again", async () => {
    const { routes } = server();
    const spa = renderSpa(`${HOUSEHOLD}/members`, routes);
    // The first screen of the file also waits for its modules to be transformed, which a browser never does.
    expect((await screen.findAllByText(/Juan/, {}, { timeout: 5_000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1, name: es.members.title })).toBeVisible();
    expect(document.title).toBe(`${es.members.title} · Hearth`);
    const ledger = count(spa.requests, "GET", /\/transactions$/);
    const me = count(spa.requests, "GET", /\/me$/);

    await userEvent.click(screen.getByRole("button", { name: /^Revocar/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Revocar/ })).not.toBeInTheDocument());
    expect(count(spa.requests, "GET", /\/invitations$/)).toBeGreaterThan(1);
    expect(count(spa.requests, "GET", /\/transactions$/)).toBe(ledger);
    expect(count(spa.requests, "GET", /\/me$/)).toBe(me);
  });

  it("answers a personal space's members, balances and history with the not-found screen (P159)", async () => {
    const { routes } = server();
    renderSpa("/spaces/sp-personal/balances", routes);
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });

  it("settles up from a suggestion: the balances, the suggestions and the ledger are read again, the profile is not", async () => {
    const { routes } = server();
    const spa = renderSpa(`${HOUSEHOLD}/balances`, routes);
    await userEvent.click(
      await screen.findByRole("button", { name: named("Liquidar: Juan le paga $ 100.000 a Ana") }),
    );
    const dialog = screen.getByRole("dialog", { name: "Registrar pago" });
    const balances = count(spa.requests, "GET", /\/balances$/);
    const me = count(spa.requests, "GET", /\/me$/);

    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar pago" }));

    await waitFor(() => expect(count(spa.requests, "GET", /\/balances$/)).toBeGreaterThan(balances));
    expect(count(spa.requests, "POST", /\/settlements$/)).toBe(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: named("Liquidar: Juan le paga $ 100.000 a Ana") }),
      ).not.toBeInTheDocument(),
    );
    expect(count(spa.requests, "GET", /\/me$/)).toBe(me);
  });

  it("shows a member's balance history, and a member who is not one of the space's is not found", async () => {
    const { routes } = server();
    const spa = renderSpa(`${HOUSEHOLD}/members/m-juan/history`, routes);
    expect(await screen.findByRole("heading", { name: /Juan/ })).toBeVisible();
    await spa.router.navigate({ href: `${HOUSEHOLD}/members/m-gone/history` });
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });

  it("opens an invitation to anyone without sending them to sign in, and accepting lands in the space joined", async () => {
    const visitor = server(false);
    const open = renderSpa("/invitations/tok-1", visitor.routes);
    expect((await screen.findAllByText(/Trip/)).length).toBeGreaterThan(0);
    expect(open.location()).toBe("/invitations/tok-1");
    open.unmount();

    const { routes } = server();
    const spa = renderSpa("/invitations/tok-1", routes);
    await userEvent.click(await screen.findByRole("button", { name: "Aceptar y entrar a Trip" }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-trip?joined=1"));
    expect(
      await screen.findByRole("button", { name: es.shell.space.current.replace("{name}", "Trip") }),
    ).toBeVisible();
    // U6: the one-time welcome, on the home of the space joined.
    expect(await screen.findByText(es.spaces.joined.title.replace("{space}", "Trip"))).toBeVisible();
  });

  it("lands a person who opened the invitation first thing in the space joined, with every other space", async () => {
    const { routes } = server();
    const spa = renderSpa("/invitations/tok-1", routes);
    // Nothing read the person's spaces yet: the invitation screen is the first one they open.
    expect(spa.queryClient.getQueryData(["spaces", "list"])).toBeUndefined();
    await userEvent.click(
      await screen.findByRole("button", { name: "Aceptar y entrar a Trip" }, { timeout: 5_000 }),
    );
    expect(await screen.findByText(es.spaces.joined.title.replace("{space}", "Trip"))).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Algo salió mal" })).toBeNull();
  });
  it("tries an invitation's preview once more when the server fails it (5xx), as it may pass a moment later", async () => {
    const { routes } = server(false);
    let failures = 1;
    renderSpa("/invitations/tok-1", {
      ...routes,
      "GET /api/v1/invitations/{token}": (request, params) =>
        failures-- > 0
          ? problemResponse(503, "ServiceUnavailable")
          : routes["GET /api/v1/invitations/{token}"]!(request, params),
    });
    expect((await screen.findAllByText(/Trip/, {}, { timeout: 4_000 })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
