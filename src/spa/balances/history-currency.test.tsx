import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { MoneyDto } from "@/shared/ui/api/dto";
import {
  cop,
  friendDto,
  householdSpace,
  meDto,
  memberDto,
  money,
  normalized,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";

const HOUSEHOLD = "/spaces/sp-household";
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

/** Ana's Household, where Juan owes her 100,000 COP and 40 USD, over a fake /api/v1. */
const server = (juanNets: MoneyDto[]): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto(), JUAN] }),
  "GET /api/v1/spaces/{spaceId}/balances": () =>
    jsonResponse({
      members: [
        {
          memberId: "m-ana",
          net: cop(100_000),
          nets: juanNets.map((m) => ({ ...m, amount: m.amount.replace(/^-/, "") })),
        },
        { memberId: "m-juan", net: cop(-100_000), nets: juanNets },
      ],
    }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [OCTOBER] }),
  "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": (request, { memberId }) => {
    const usd = new URL(request.url).searchParams.get("currency") === "USD";
    const change = usd ? money(-40, "USD") : cop(-100_000);
    return jsonResponse({
      memberId,
      from: "2026-10-01",
      to: "2026-10-31",
      opening: usd ? money(0, "USD") : cop(0),
      closing: change,
      entries: [
        {
          transactionId: usd ? "t-taxi" : "t-market",
          type: "EXPENSE",
          date: "2026-10-12",
          description: usd ? "Taxi" : "Mercado",
          change,
          balance: change,
        },
      ],
    });
  },
});

const histories = (requests: Request[]) =>
  requests
    .filter((r) => r.method === "GET" && /\/balance-history$/.test(new URL(r.url).pathname))
    .map((r) => new URL(r.url).searchParams.get("currency"));

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("a member's history per currency in the SPA (ruling P342, S4)", () => {
  it("reads the history again in the currency its chip chooses", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/members/m-juan/history`, server([cop(-100_000), money(-40, "USD")]));
    expect(await screen.findByText("Mercado")).toBeVisible();
    expect(histories(spa.requests)).toEqual([null]);
    const chips = screen.getByRole("navigation", { name: "Moneda" });
    await userEvent.click(within(chips).getByRole("link", { name: "USD" }));
    expect(await screen.findByText("Taxi")).toBeVisible();
    // The hover's prefetch and the tap's visit may each read it (ADR 0006); every read after the first asks for USD.
    const [first, ...after] = histories(spa.requests);
    expect([first, [...new Set(after)]]).toEqual([null, ["USD"]]);
    expect(normalized(screen.getByRole("list").textContent)).toContain("40 USD");
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Moneda" })).getByRole("link", { name: "USD" }),
      ).toHaveAttribute("aria-current", "page"),
    );
  });

  it("offers no choice to a member with one currency", async () => {
    renderSpa(`${HOUSEHOLD}/members/m-juan/history`, server([cop(-100_000)]));
    expect(await screen.findByText("Mercado")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Moneda" })).not.toBeInTheDocument();
  });
});

describe("a person of Amigos per currency in the SPA (ruling P342, S4)", () => {
  const NETS = [cop(500_000), money(50, "USD")];
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () =>
      jsonResponse({
        items: [spaceDto(), spaceDto({ id: "sp-mama", name: "Mamá", kind: "DIRECT", role: "OWNER" })],
      }),
    "GET /api/v1/me/friends": () => jsonResponse({ items: [friendDto({ nets: NETS })] }),
    "GET /api/v1/spaces/{spaceId}/members": () =>
      jsonResponse({
        items: [
          memberDto({ id: "m-ana-mama" }),
          memberDto({ id: "m-mama", userId: "u-mama", displayName: "Mamá" }),
        ],
      }),
    "GET /api/v1/spaces/{spaceId}/balances": () =>
      jsonResponse({ members: [{ memberId: "m-ana-mama", net: cop(500_000), nets: NETS }] }),
    "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => jsonResponse({ suggestions: [] }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
    "GET /api/v1/spaces/{spaceId}/members/{memberId}/balance-history": (request, { memberId }) => {
      const usd = new URL(request.url).searchParams.get("currency") === "USD";
      const change = usd ? money(50, "USD") : cop(500_000);
      return jsonResponse({
        memberId,
        from: null,
        to: null,
        opening: usd ? money(0, "USD") : cop(0),
        closing: change,
        entries: [
          {
            transactionId: usd ? "t-miami" : "t-loan",
            type: "EXPENSE",
            date: usd ? "2026-11-15" : "2025-03-12",
            description: usd ? "Cena en Miami" : "Préstamo",
            change,
            balance: change,
          },
        ],
      });
    },
  };

  it("reads the movements of each currency the two owe each other in and lists them together", async () => {
    const spa = renderSpa("/spaces/sp-personal/friends/sp-mama", routes);
    expect(await screen.findByText("Cena en Miami")).toBeVisible();
    expect(screen.getByText("Préstamo")).toBeVisible();
    expect(new Set(histories(spa.requests))).toEqual(new Set([null, "USD"]));
    expect(normalized(screen.getByRole("region", { name: "Mamá te debe" }).textContent)).toContain("50 USD");
  });
});
