import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { es } from "@/i18n/messages/full";
import {
  accountDto,
  cop,
  householdSpace,
  meDto,
  memberDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

/** Ana's standing in Household: her turn to put 120,000 COP in, to Juan (ruling P278). */
const anaOwesJuan = {
  spaceId: "sp-household",
  memberId: "m-ana",
  net: cop(-120_000),
  members: [
    { memberId: "m-ana", name: "Ana" },
    { memberId: "m-juan", name: "Juan" },
    { memberId: "m-luis", name: "Luis" },
  ],
  payments: [{ receivingMemberId: "m-juan", amount: cop(120_000) }],
};

/** Ana's personal space and Household over a fake /api/v1. */
const api = (overrides: Record<string, FakeHandler> = {}): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/balances": () => jsonResponse({ items: [anaOwesJuan] }),
  ...overrides,
});

const balanceReads = (requests: Request[]) =>
  requests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/v1/me/balances").length;

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});

describe("Inicio and the space switcher read the person's balances (#240, ruling P278)", () => {
  it("shows the personal home her turn to put money in Household, with Saldar opening its settle sheet", async () => {
    renderSpa("/spaces/sp-personal", api());
    const card = await screen.findByRole("region", { name: /Te toca poner/ }, { timeout: 15_000 });
    expect(card.textContent?.replace(/\s/g, " ")).toContain("Te toca poner $ 120.000 a Juan");
    expect(card).toHaveTextContent("En Household");
    expect(within(card).getByRole("link", { name: "Saldar con Juan en Household" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/balances?settle=m-ana",
    );
  });

  it("shows a shared home the card of that space only", async () => {
    renderSpa("/spaces/sp-household", api());
    expect(
      await screen.findByRole("region", { name: /Te toca poner/ }, { timeout: 15_000 }),
    ).toHaveTextContent("En Household");
  });

  it("puts Inicio's eye in the header, and hiding the amounts hides the switcher's too", async () => {
    renderSpa("/spaces/sp-personal", api());
    const banner = await screen.findByRole("banner", {}, { timeout: 15_000 });
    const eye = await within(banner).findByRole("button", { name: es.home.hideAmounts });
    await userEvent.click(eye);
    expect(await screen.findByRole("region", { name: /Te toca poner/ })).not.toHaveTextContent("120.000");
    await userEvent.click(within(banner).getByRole("button", { name: /Cambiar de espacio/ }));
    const sheet = await screen.findByRole("dialog", { name: es.shell.space.title });
    const household = within(sheet).getByRole("link", { name: /Household/ });
    await waitFor(() => expect(household).toHaveTextContent("Ana, Juan y Luis"));
    expect(household).toHaveTextContent("Te toca poner");
    expect(household).not.toHaveTextContent("120.000");
    // The choice outlives the screen for the rest of the visit: show the amounts again for the next test.
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(banner).getByRole("button", { name: es.home.hideAmounts }));
    expect(localStorage.getItem("hearth.hideAmounts.u-ana")).toBeNull();
  });

  it("names Household's members and Ana's turn in the switcher", async () => {
    renderSpa("/spaces/sp-personal", api());
    await userEvent.click(
      await screen.findByRole("button", { name: /Cambiar de espacio/ }, { timeout: 15_000 }),
    );
    const sheet = await screen.findByRole("dialog", { name: es.shell.space.title });
    const household = within(sheet).getByRole("link", { name: /Household/ });
    await waitFor(() => expect(household).toHaveTextContent("Ana, Juan y Luis"));
    expect(household.textContent?.replace(/\s/g, " ")).toContain("Te toca poner$ 120.000");
  });

  it("reads no balances for a person with only her personal space, even with the switcher open", async () => {
    const spa = renderSpa(
      "/spaces/sp-personal",
      api({ "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto()] }) }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Cambiar de espacio/ }, { timeout: 15_000 }),
    );
    expect(await screen.findByRole("dialog", { name: es.shell.space.title })).toBeVisible();
    await waitFor(() => expect(spa.queryClient.isFetching()).toBe(0));
    expect(balanceReads(spa.requests)).toBe(0);
    expect(screen.queryByRole("region", { name: /Te toca poner/ })).not.toBeInTheDocument();
  });
});
