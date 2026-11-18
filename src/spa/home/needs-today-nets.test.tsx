import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { MoneyDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  cop,
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

/** Ana's personal space and Household, where her nets are `nets` (P342) and `net` only says the space's currency. */
const api = (nets: MoneyDto[]): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/reports/lines": (_request, { spaceId }) =>
    jsonResponse(e7Dashboard({ spaceId, period: octoberPage.period })),
  "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified({ period: octoberPage.period })),
  "GET /api/v1/me/activity": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/balances": () =>
    jsonResponse({
      items: [
        {
          spaceId: "sp-household",
          memberId: "m-ana",
          net: cop(0),
          nets,
          members: [
            { memberId: "m-ana", name: "Ana" },
            { memberId: "m-juan", name: "Juan" },
          ],
          payments: nets
            .filter((net) => net.amount.startsWith("-"))
            .map((net) => ({ receivingMemberId: "m-juan", amount: { ...net, amount: net.amount.slice(1) } })),
        },
      ],
    }),
  "GET /api/v1/me/friends": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/pending-occurrences": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/pending-occurrences": () => jsonResponse({ items: [] }),
});

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});

describe("Inicio's Te necesita hoy counts every currency (ruling P342, S4)", () => {
  it("says it is Ana's turn when she owes only in dollars, her pesos even", async () => {
    renderSpa("/spaces/sp-personal", api([money(-50, "USD")]));
    const card = await screen.findByRole("region", { name: "Te necesita hoy" }, { timeout: 15_000 });
    await waitFor(() => expect(normalized(card.textContent)).toContain("Te toca poner 50 USD"));
  });

  it("says Juan owes her when only her dollars are owed to her", async () => {
    renderSpa("/spaces/sp-personal", api([money(40, "USD")]));
    const card = await screen.findByRole("region", { name: "Te necesita hoy" }, { timeout: 15_000 });
    await waitFor(() => expect(normalized(card.textContent)).toContain("40 USD"));
    expect(normalized(card.textContent)).not.toContain("Te toca poner");
  });
});
