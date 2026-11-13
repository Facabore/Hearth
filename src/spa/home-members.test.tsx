import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accountDto,
  cop,
  householdSpace,
  meDto,
  memberDto,
  rowContext,
  spaceDto,
  transactionDto,
} from "../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

/** Household's latest movement: Juan paid Ana back 50,000 COP. */
const settlement = transactionDto({
  id: "t-settle",
  type: "SETTLEMENT",
  description: "",
  amount: cop(50_000),
  date: "2026-10-25",
  categoryId: null,
  payerMemberId: "m-juan",
  receivingMemberId: "m-ana",
});

const api = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces/{spaceId}/transactions": () =>
    jsonResponse({
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
      totals: { expenses: cop(0), income: cop(0) },
      items: [settlement],
      nextCursor: null,
    }),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
  "GET /api/v1/spaces/{spaceId}/members": () =>
    jsonResponse({
      items: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })],
    }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/balances": () => jsonResponse({ items: [] }),
});

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});

describe("a shared space's rows say 'pagaste tú' for the viewer's own payment (P324)", () => {
  it("reads Ana's expense in Hogar's Movimientos as 'pagaste tú', not 'pagó Ana'", async () => {
    const expense = transactionDto({
      id: "t-domicilio",
      type: "EXPENSE",
      description: "Domicilio",
      amount: cop(64_000),
      date: "2026-10-25",
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(64_000) }],
    });
    renderSpa("/spaces/sp-household/transactions", {
      ...api(),
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        jsonResponse({
          period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
          totals: { expenses: cop(64_000), income: cop(0) },
          items: [expense],
          nextCursor: null,
        }),
      "GET /api/v1/spaces/{spaceId}/balances": () => jsonResponse({ members: [] }),
    });
    const row = await screen.findByRole("link", { name: /Domicilio/ }, { timeout: 15_000 });
    const text = row.textContent?.replace(/\s/g, " ") ?? "";
    expect(text).toContain("pagaste tú");
    expect(text).not.toContain("pagó Ana");
  });
});

describe("Inicio of a shared space names who paid whom (P307)", () => {
  it("reads a settlement between members as 'Juan → Ana', not a bare arrow", async () => {
    renderSpa("/spaces/sp-household", api());
    const row = await screen.findByRole("link", { name: /Pago entre miembros/ }, { timeout: 15_000 });
    expect(row.textContent?.replace(/\s/g, " ")).toContain("Juan → Ana");
  });
});
