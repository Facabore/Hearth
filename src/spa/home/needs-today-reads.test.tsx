import { cleanup, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accountDto,
  cop,
  householdSpace,
  meDto,
  memberDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { e74Unified, e7Dashboard } from "../../../tests/support/ui/plan-dto";
import { renderSpa } from "../../../tests/support/ui/spa";

/** Household's "Energía", which waits for its real amount (HU-E4-13). */
const energy = {
  id: "o-energy",
  recurrenceId: "r-energy",
  type: "EXPENSE",
  description: "Energía",
  date: "2026-10-20",
  status: "PENDING",
  amount: cop(180_000),
  categoryId: null,
  transactionId: null,
  reason: null,
};

/** Ana's direct space with each of her `count` friends (ruling P338). */
const friends = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    spaceDto({ id: `sp-friend-${i}`, name: `Amigo ${i}`, kind: "DIRECT", role: "MEMBER" }),
  );

/** Ana's personal space, Household and her direct spaces over a fake /api/v1; only Household has a bill waiting. */
const api = (friendCount: number): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () =>
    jsonResponse({ items: [spaceDto(), householdSpace(), ...friends(friendCount)] }),
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
  "GET /api/v1/me/balances": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/friends": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/pending-occurrences": () =>
    jsonResponse({ items: [{ ...energy, spaceId: "sp-household" }] }),
  "GET /api/v1/spaces/{spaceId}/pending-occurrences": (_request, { spaceId }) =>
    jsonResponse({ items: spaceId === "sp-household" ? [energy] : [] }),
});

const gets = (requests: Request[]) =>
  requests.filter((r) => r.method === "GET").map((r) => new URL(r.url).pathname);
const perSpacePending = (requests: Request[]) =>
  gets(requests).filter((path) => /^\/api\/v1\/spaces\/[^/]+\/pending-occurrences$/.test(path));

/** Opens `url`, waits for Household's bill in "Te necesita hoy" and for every read to settle; returns the GETs. */
const openHome = async (url: string, friendCount: number) => {
  const spa = renderSpa(url, api(friendCount));
  const card = await screen.findByRole("region", { name: "Te necesita hoy" }, { timeout: 15_000 });
  await waitFor(() => expect(card).toHaveTextContent("Energía por confirmar"));
  expect(card.textContent?.replace(/\s/g, " ")).toContain("sugerido $ 180.000");
  await waitFor(() => expect(spa.queryClient.isFetching()).toBe(0));
  return spa.requests;
};

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});

describe("Inicio's bills to confirm cost a constant number of reads (#338)", () => {
  it("reads every space's pending bills once on the personal Inicio, whatever the number of friends", async () => {
    // The file's first visit reads the session and the spaces once more than later ones do: count later visits only.
    await openHome("/spaces/sp-personal", 1);
    cleanup();
    const withOne = await openHome("/spaces/sp-personal", 1);
    cleanup();
    const withThirteen = await openHome("/spaces/sp-personal", 13);

    for (const requests of [withOne, withThirteen]) {
      expect(gets(requests).filter((path) => path === "/api/v1/me/pending-occurrences")).toHaveLength(1);
      // Only the shell's badge reads a space of its own: the personal space the person is in.
      expect(new Set(perSpacePending(requests))).toEqual(
        new Set(["/api/v1/spaces/sp-personal/pending-occurrences"]),
      );
    }
    expect(gets(withThirteen)).toHaveLength(gets(withOne).length);
  });

  it("reads only its own space's pending bills on a shared Inicio", async () => {
    const requests = await openHome("/spaces/sp-household", 13);

    expect(gets(requests)).not.toContain("/api/v1/me/pending-occurrences");
    expect(new Set(perSpacePending(requests))).toEqual(
      new Set(["/api/v1/spaces/sp-household/pending-occurrences"]),
    );
  });
});
