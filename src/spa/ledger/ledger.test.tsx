import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import {
  accountDto,
  householdSpace,
  meDto,
  memberDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";

/** A request the API never answers: whatever shows meanwhile came from the cache. */
const never = (): Promise<Response> => new Promise<Response>(() => undefined);

/** Ana's personal space and Household over a fake /api/v1; `hold` makes the named reads hang from then on. */
const ledgerApi = (overrides: Record<string, FakeHandler> = {}) => {
  const hold = new Set<string>();
  const held =
    (name: string, handler: FakeHandler): FakeHandler =>
    (request, params) =>
      hold.has(name) ? never() : handler(request, params);
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces/{spaceId}/transactions": held("page", () => jsonResponse(octoberPage)),
    "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": held(
      "transaction",
      (_, { transactionId }) => {
        const tx = octoberPage.items.find((item) => item.id === transactionId);
        return tx ? jsonResponse(tx) : problemResponse(404, "TransactionNotFound");
      },
    ),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    ...overrides,
  };
  return { routes, hold };
};

const calls = (requests: Request[], method: string, pattern: RegExp) =>
  requests.filter(
    (request) =>
      request.method === method && pattern.test(new URL(request.url).pathname + new URL(request.url).search),
  );

const nav = () => screen.getByRole("navigation", { name: es.shell.nav.main });

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the ledger flow in the SPA (slice 2 of #199, ADR 0006)", () => {
  it("shows the home's latest rows, and `?tx=` opens that row's detail sheet over it (P189)", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal?tx=t-dinner", routes);
    expect(await screen.findByRole("dialog", { name: "Dinner" })).toBeVisible();
    // The modal sheet hides the home from assistive technology; the home is still under it.
    expect(screen.getByRole("heading", { name: es.home.recent, hidden: true })).toBeInTheDocument();
    expect(calls(spa.requests, "GET", /\/transactions\?limit=3$/)).toHaveLength(1);
    expect(document.title).toBe(`${es.home.title} · Hearth`);
  });

  it("lists Movimientos by day with the API's totals, under the space's own filters", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal/transactions?period=2026-10&category=c-dining", routes);
    expect(await screen.findByRole("heading", { level: 1, name: es.ledger.list.title })).toBeVisible();
    expect(screen.getByText("Salary")).toBeInTheDocument();
    expect(
      calls(spa.requests, "GET", /\/transactions\?period=2026-10&categoryIds=c-dining&limit=50$/),
    ).toHaveLength(1);
    // Every category and account, archived ones too: old rows keep their names (ruling P130).
    expect(calls(spa.requests, "GET", /\/categories\?archived=true$/)).toHaveLength(1);
    expect(document.title).toBe(`${es.ledger.list.title} · Hearth`);
  });

  it("paints a second visit to Movimientos from the cache at once, and revalidates it in the background", async () => {
    const { routes, hold } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal/transactions", routes);
    await screen.findByText("Salary");
    await userEvent.click(within(nav()).getByRole("link", { name: es.shell.nav.home }));
    await screen.findByRole("heading", { name: es.home.recent });
    const before = calls(spa.requests, "GET", /\/transactions\?limit=50$/).length;

    hold.add("page");
    await userEvent.click(within(nav()).getByRole("link", { name: es.shell.nav.transactions }));

    // The API never answers now: the rows can only come from the cache.
    expect(await screen.findByText("Salary")).toBeVisible();
    expect(spa.location()).toBe("/spaces/sp-personal/transactions");
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/transactions\?limit=50$/).length).toBeGreaterThan(before),
    );
  });

  it("prefetches a row's detail on intent, so tapping it opens the sheet without waiting on the API", async () => {
    const { routes, hold } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal/transactions", routes);
    const row = await screen.findByRole("link", { name: /Dinner/ });
    await userEvent.hover(row);
    await waitFor(() => expect(calls(spa.requests, "GET", /\/transactions\/t-dinner$/)).toHaveLength(1));

    hold.add("transaction");
    await userEvent.click(row);

    expect(await screen.findByRole("dialog", { name: "Dinner" })).toBeVisible();
    expect(spa.location()).toBe("/spaces/sp-personal/transactions?tx=t-dinner");
  });

  it("shows a missing transaction's problem in its sheet and keeps the list under it (P189)", async () => {
    const { routes } = ledgerApi();
    renderSpa("/spaces/sp-personal/transactions?tx=t-gone", routes);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("opens the record form on the space's active accounts and categories, as `?type=` names it", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal/new?type=income", routes);
    expect(await screen.findByRole("tab", { name: es.ledger.type.INCOME, selected: true })).toBeVisible();
    expect(calls(spa.requests, "GET", /\/sp-personal\/categories$/)).toHaveLength(1);
    expect(calls(spa.requests, "GET", /\/sp-personal\/accounts$/)).toHaveLength(1);
    // P172: a personal expense can be split with the people of the person's other spaces.
    expect(calls(spa.requests, "GET", /\/sp-household\/members$/)).toHaveLength(1);
    expect(document.title).toBe(`${es.ledger.form.title} · Hearth`);
  });

  it("opens the edit form on the transaction, and a transaction that does not exist is not found", async () => {
    const { routes } = ledgerApi();
    renderSpa(
      `/spaces/sp-personal/transactions/t-dinner/edit?returnTo=${encodeURIComponent("/spaces/sp-personal/transactions")}`,
      routes,
    );
    expect(await screen.findByRole("button", { name: es.ledger.edit.save })).toBeVisible();
    expect(screen.getByDisplayValue("Dinner")).toBeInTheDocument();
    expect(document.title).toBe(`${es.ledger.edit.title} · Hearth`);
  });

  it("answers an edit of a transaction that is gone with the not-found screen", async () => {
    const { routes } = ledgerApi();
    renderSpa("/spaces/sp-personal/transactions/t-gone/edit", routes);
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });

  it("shows the sheet again instead of an edit the viewer may not make (P190)", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto({ role: "VIEWER" }), householdSpace()] }),
    });
    const spa = renderSpa("/spaces/sp-personal/transactions/t-dinner/edit", routes);
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/transactions?tx=t-dinner"));
  });

  it("gives a viewer no Registrar button, and her link to the form names her role instead (#207)", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ role: "VIEWER" })] }),
    });
    renderSpa("/spaces/sp-household/new", routes);
    expect(
      await screen.findByText(
        es.ledger.form.readOnly.replace("{space}", "Household").replace("{role}", es.shell.role.VIEWER),
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: es.ledger.form.save.EXPENSE })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: es.common.back })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
    expect(within(nav()).queryByRole("link", { name: es.shell.nav.record })).not.toBeInTheDocument();
  });

  it("keeps the Registrar button for a member who records", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ role: "MEMBER" })] }),
    });
    renderSpa("/spaces/sp-household/new", routes);
    expect(await screen.findByRole("button", { name: es.ledger.form.save.EXPENSE })).toBeVisible();
    expect(within(nav()).getByRole("link", { name: es.shell.nav.record })).toBeInTheDocument();
  });

  it("shows a read the API refuses as its problem, inside the shell", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces/{spaceId}/categories": () => problemResponse(500, "InternalError"),
    });
    renderSpa("/spaces/sp-personal/transactions", routes);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
  });
});
