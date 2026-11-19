import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountDto, SpaceDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  cop,
  friendDto,
  householdSpace,
  meDto,
  memberDto,
  money,
  normalized,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { e74Unified, e7Dashboard } from "../../../tests/support/ui/plan-dto";
import { renderSpa } from "../../../tests/support/ui/spa";

/** Board "Inicio · total aproximado": 1.240.000 COP, 80 USD and 25 EUR, ≈ 1.660.000 COP at today's rate. */
const SEVERAL = {
  byCurrency: [cop(1_240_000), money(80, "USD"), money(25, "EUR")],
  approximate: { total: cop(1_660_000), unrated: [] },
};
const ONE = { byCurrency: [cop(1_575_000)] };
const DIRECT = spaceDto({ id: "sp-mama", name: "Mamá", kind: "DIRECT", role: "OWNER" });
/** Board "Amigos · una deuda por moneda": Mamá owes her in three currencies, she owes Jhon López in pesos. */
const FRIENDS = [
  friendDto({ nets: [cop(500_000), money(50, "USD"), money(60, "EUR")] }),
  friendDto({
    spaceId: "sp-jhon",
    other: { memberId: "m-jhon", kind: "USER", displayName: "Jhon López", nickname: null },
    name: "Jhon López",
    net: cop(-120_000),
    nets: [cop(-120_000), money(30, "USD")],
    lastMovement: null,
  }),
];
const APPROXIMATE = {
  currency: "COP",
  owedToYou: { total: cop(2_085_000), unrated: [] },
  youOwe: { total: cop(120_000), unrated: [] },
};

/** Ana's Inicio over a fake /api/v1: her spaces, her accounts, her month's view and her Amigos. */
const api = ({
  spaces = [spaceDto()],
  accounts = [accountDto({ id: "a-bank", name: "Bancolombia" })],
  view = e74Unified({ period: octoberPage.period, spending: ONE }),
  friends = { items: [] as unknown[] } as Record<string, unknown>,
}: {
  spaces?: SpaceDto[];
  accounts?: AccountDto[];
  view?: UnifiedViewDto;
  friends?: Record<string, unknown>;
} = {}): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: spaces }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
  "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: accounts }),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/reports/lines": (_request, { spaceId }) =>
    jsonResponse(e7Dashboard({ spaceId, period: octoberPage.period })),
  "GET /api/v1/me/unified-view": () => jsonResponse(view),
  "GET /api/v1/me/activity": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/balances": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/friends": () => jsonResponse(friends),
  "GET /api/v1/me/friend-requests": () => jsonResponse({ incoming: [], outgoing: [] }),
  "GET /api/v1/me/pending-occurrences": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/pending-occurrences": () => jsonResponse({ items: [] }),
});

const count = (requests: readonly Request[], path: RegExp) =>
  requests.filter((r) => r.method === "GET" && path.test(new URL(r.url).pathname)).length;
/** Inicio's hero, the first time it draws. */
const hero = async () =>
  normalized(
    (await screen.findByRole("region", { name: "Resumen del período" }, { timeout: 15_000 })).textContent,
  );

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});

describe('Inicio\'s month across currencies (ruling P342 S6, board "Inicio · total aproximado")', () => {
  it("draws ≈ in pesos with each currency under it in the first paint, for someone with shared spaces", async () => {
    renderSpa(
      "/spaces/sp-personal",
      api({
        spaces: [spaceDto(), householdSpace()],
        view: e74Unified({ period: octoberPage.period, spending: SEVERAL }),
      }),
    );
    expect(await hero()).toBe(
      "Gastaste en octubre≈ 1.660.000 COP1.240.000 COP · 80 USD · 25 EUR. En pesos, a la tasa de hoy.",
    );
  });

  it("keeps the hero as it was when her month is in one currency", async () => {
    renderSpa("/spaces/sp-personal", api({ spaces: [spaceDto(), householdSpace()] }));
    const text = await hero();
    expect(text).toContain("1.575.000 COP");
    expect(text).not.toContain("≈");
    expect(text).not.toContain("a la tasa de hoy");
  });

  it("reads her month ahead when an account of hers is in another currency, so the ≈ figure never jumps", async () => {
    const spa = renderSpa(
      "/spaces/sp-personal",
      api({
        accounts: [
          accountDto({ id: "a-bank", name: "Bancolombia" }),
          accountDto({
            id: "a-usd",
            name: "Dólares",
            balance: money(80, "USD"),
            openingBalance: money(0, "USD"),
          }),
        ],
        view: e74Unified({ period: octoberPage.period, spending: SEVERAL }),
      }),
    );
    expect(await hero()).toBe(
      "Gastaste en octubre≈ 1.660.000 COP1.240.000 COP · 80 USD · 25 EUR. En pesos, a la tasa de hoy.",
    );
    expect(count(spa.requests, /\/me\/unified-view$/)).toBe(1);
  });

  it("adds no request for someone alone whose accounts and latest movements are all in pesos", async () => {
    const spa = renderSpa("/spaces/sp-personal", api());
    expect(await hero()).toBe("Gastaste en octubre245.000 COPIngresos +3.200.000 COP");
    expect(count(spa.requests, /\/me\/unified-view$/)).toBe(0);
  });
});

describe("Amigos' ≈ totals reach the screens from one read (ruling P342 S6)", () => {
  it("gives Inicio's line to Amigos the ≈ totals, in both directions", async () => {
    const spa = renderSpa(
      "/spaces/sp-personal",
      api({ spaces: [spaceDto(), DIRECT], friends: { items: FRIENDS, approximate: APPROXIMATE } }),
    );
    const line = await screen.findByRole("link", { name: /^Amigos · / }, { timeout: 15_000 });
    await waitFor(() =>
      expect(normalized(line.textContent)).toBe("Amigos · te deben ≈ 2.085.000 COP · debes ≈ 120.000 COP›"),
    );
    expect(count(spa.requests, /\/me\/friends$/)).toBe(1);
  });

  it("heads Amigos with the ≈ totals and the note, reading Amigos once", async () => {
    const spa = renderSpa(
      "/spaces/sp-personal/balances",
      api({ spaces: [spaceDto(), DIRECT], friends: { items: FRIENDS, approximate: APPROXIMATE } }),
    );
    const header = (
      await screen.findByRole("heading", { level: 1, name: "Amigos" }, { timeout: 15_000 })
    ).closest("header")!;
    expect(normalized(within(header).getByText(/^Te deben/).textContent)).toBe(
      "Te deben ≈ 2.085.000 COP · Debes ≈ 120.000 COP",
    );
    expect(
      within(header).getByText("En pesos, a la tasa de hoy. Cada deuda sigue en su moneda."),
    ).toBeVisible();
    expect(count(spa.requests, /\/me\/friends$/)).toBe(1);
  });

  it("keeps Amigos' totals per currency when every debt is in one", async () => {
    renderSpa(
      "/spaces/sp-personal/balances",
      api({ spaces: [spaceDto(), DIRECT], friends: { items: [friendDto()] } }),
    );
    const header = (
      await screen.findByRole("heading", { level: 1, name: "Amigos" }, { timeout: 15_000 })
    ).closest("header")!;
    expect(normalized(within(header).getByText(/^Te deben/).textContent)).toBe(
      "Te deben 500.000 COP · Debes 0 COP",
    );
    expect(within(header).queryByText(/a la tasa de hoy/)).toBeNull();
  });
});
