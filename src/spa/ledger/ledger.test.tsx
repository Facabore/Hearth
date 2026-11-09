import { createBrowserHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import {
  accountDto,
  activityItemDto,
  categoryDto,
  householdSpace,
  meDto,
  memberDto,
  octoberPage,
  rowContext,
  spaceDto,
  transactionDto,
} from "../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { e74Unified, e7Dashboard } from "../../../tests/support/ui/plan-dto";
import { renderSpa } from "../../../tests/support/ui/spa";
import { createSpa } from "../app";
import { moduleKeys } from "../reads";

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

/** No read in flight and the router idle: whatever a loader started without awaiting has run. */
const settled = (spa: ReturnType<typeof renderSpa>) =>
  waitFor(() => {
    expect(spa.queryClient.isFetching()).toBe(0);
    expect(spa.router.state.status).toBe("idle");
  });

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
    // Ruling P306: the personal home of someone with another space merges six rows, so it reads six of its own.
    expect(calls(spa.requests, "GET", /\/transactions\?limit=6$/)).toHaveLength(1);
    expect(document.title).toBe(`${es.home.title} · Hearth`);
  });

  it("counts the month across every space on the personal home and merges their movements into Recientes (P306)", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified({ period: { ...octoberPage.period } })),
      "GET /api/v1/me/activity": () =>
        jsonResponse({
          items: [
            activityItemDto({
              transaction: transactionDto({
                id: "t-hogar",
                description: "Mercado del mes",
                date: "2026-10-30",
              }),
            }),
          ],
        }),
    });
    const spa = renderSpa("/spaces/sp-personal", routes);
    // Ruling P306: one figure, her month across her spaces, split into "Solo tú" and "Con otros".
    const summary = await screen.findByRole("region", { name: es.home.summary });
    await waitFor(() => expect(summary.textContent).toContain(es.home.solo));
    expect(summary.textContent?.replace(/\s/g, " ")).toContain("$ 1.575.000");
    expect(summary.textContent).toContain(es.home.withOthers);
    const row = await screen.findByRole("link", { name: /Mercado del mes/ });
    expect(row).toHaveAttribute("href", "/spaces/sp-hogar?tx=t-hogar");
    expect(within(row).getByText("Hogar")).toBeInTheDocument();
    expect(calls(spa.requests, "GET", /\/me\/unified-view\?period=2026-10$/)).toHaveLength(1);
    // Ruling P310: the feed stops at the period's end, so a past period lists only its own.
    expect(calls(spa.requests, "GET", /\/me\/activity\?from=2026-10-01&to=2026-10-31&limit=6$/)).toHaveLength(
      1,
    );
  });

  it("keeps the personal home without the line when the unified month cannot be read", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/me/unified-view": () => problemResponse(500, "InternalError"),
    });
    const spa = renderSpa("/spaces/sp-personal", routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    // The read has failed for good (after its one retry of a 5xx) before the home is checked.
    await waitFor(
      () =>
        expect(
          spa.queryClient.getQueryState(moduleKeys.report("sp-personal", "unified", { period: "2026-10" })),
        ).toMatchObject({ status: "error", fetchStatus: "idle" }),
      { timeout: 5_000 },
    );
    expect(screen.queryByText(es.home.withOthers)).not.toBeInTheDocument();
    // The toast provider's live region is always mounted; a failed optional read leaves it empty.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("reads no unified month for a person with no other space, nor in a shared space's home", async () => {
    const alone = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto()] }),
    });
    const spa = renderSpa("/spaces/sp-personal", alone.routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    // The loader starts the unified read without awaiting it: count only once nothing is loading any more.
    await settled(spa);
    spa.unmount();
    const shared = renderSpa("/spaces/sp-household", ledgerApi().routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(shared);
    expect(screen.queryByText(es.home.withOthers)).not.toBeInTheDocument();
    expect(calls([...spa.requests, ...shared.requests], "GET", /\/me\/(unified-view|activity)/)).toHaveLength(
      0,
    );
  });

  it("proposes the month's plan on the personal home until its period's plan has a line (#152)", async () => {
    const steps = es.home.firstSteps;
    const step = () =>
      within(screen.getByRole("region", { name: steps.title }))
        .getAllByRole("listitem")
        .find((item) => item.textContent?.includes(steps.step.plan))!;
    const empty = ledgerApi({
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(
          e7Dashboard({ spaceId: "sp-personal", period: octoberPage.period, plan: null, lines: [] }),
        ),
    });
    const spa = renderSpa("/spaces/sp-personal", empty.routes);
    expect(await screen.findByRole("link", { name: steps.step.plan })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan/lines",
    );
    expect(calls(spa.requests, "GET", /\/spaces\/sp-personal\/reports\/lines\?period=2026-10$/)).toHaveLength(
      1,
    );
    spa.unmount();
    const planned = ledgerApi({
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(e7Dashboard({ spaceId: "sp-personal", period: octoberPage.period })),
    });
    renderSpa("/spaces/sp-personal", planned.routes);
    await waitFor(() => expect(within(step()).getByText(steps.done)).toBeInTheDocument());
    expect(within(step()).queryByRole("link")).toBeNull();
  });

  it("reads no plan for the first steps in a shared space's home (#152)", async () => {
    const spa = renderSpa("/spaces/sp-household", ledgerApi().routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(spa);
    expect(calls(spa.requests, "GET", /\/reports\/lines/)).toHaveLength(0);
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

  it("asks the API for the address's account, type and search (board B1 06, P277)", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa(
      "/spaces/sp-personal/transactions?period=2026-10&acct=a-bank&type=EXPENSE&q=%20dinner%20",
      routes,
    );
    expect(await screen.findByRole("searchbox", { name: es.ledger.list.search })).toHaveValue("dinner");
    await waitFor(() =>
      expect(
        calls(
          spa.requests,
          "GET",
          /\/transactions\?period=2026-10&accountId=a-bank&type=EXPENSE&search=dinner&limit=50$/,
        ),
      ).toHaveLength(1),
    );
    expect(screen.getByRole("button", { name: "Quitar el filtro Bancolombia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar el filtro Gasto" })).toBeInTheDocument();
  });

  it("searches as the person types and keeps the field in place while the list answers (P277)", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal/transactions?period=2026-10", routes);
    const field = await screen.findByRole("searchbox", { name: es.ledger.list.search });
    await userEvent.type(field, "din{Enter}");
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/transactions?period=2026-10&q=din"));
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/transactions\?period=2026-10&search=din&limit=50$/)).toHaveLength(
        1,
      ),
    );
    expect(screen.getByRole("searchbox", { name: es.ledger.list.search })).toBe(field);
    expect(field).toHaveFocus();
  });

  it("reads the space's recent periods for the period chip, and moves to the one chosen (P277)", async () => {
    const september = { label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" };
    const { routes } = ledgerApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [september, octoberPage.period] }),
    });
    const spa = renderSpa("/spaces/sp-personal/transactions?period=2026-10", routes);
    await screen.findByText("Salary");
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/periods\?from=\d{4}-\d{2}-\d{2}&count=24$/)).toHaveLength(1),
    );
    await userEvent.click(screen.getByRole("button", { name: "octubre 2026" }));
    const sheet = await screen.findByRole("dialog", { name: es.ledger.list.periods });
    await userEvent.click(within(sheet).getByRole("link", { name: "septiembre 2026" }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/transactions?period=2026-09"));
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

  it("reads a screen once however often the pointer passes over its link, and a tap still revalidates it", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa("/spaces/sp-personal", routes);
    await screen.findByRole("heading", { name: es.home.recent });
    const link = within(nav()).getByRole("link", { name: es.shell.nav.transactions });
    const list = () => calls(spa.requests, "GET", /\/transactions\?limit=50$/).length;

    for (let pass = 0; pass < 3; pass += 1) {
      await userEvent.hover(link);
      await waitFor(() => expect(list()).toBe(1));
      await userEvent.unhover(link);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(list()).toBe(1);

    await userEvent.click(link);
    await screen.findByText("Salary");
    // Arriving at the screen is a visit, which refreshes what it shows in the background (ADR 0006).
    await waitFor(() => expect(list()).toBe(2));
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

  it("moves the record form to another space with what was typed, and keeps where it was opened from (P305)", async () => {
    const { routes } = ledgerApi();
    const returnTo = encodeURIComponent("/spaces/sp-personal/transactions");
    const spa = renderSpa(`/spaces/sp-personal/new?returnTo=${returnTo}`, routes);
    const amount = await screen.findByLabelText(es.ledger.form.amount);
    await userEvent.type(amount, "25000");
    await userEvent.type(screen.getByLabelText(es.ledger.form.description), "Farmacia");
    // A category of this space, chosen before the move.
    const tile = document.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    await userEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: /^Espacio: Personal/ }));
    const sheet = await screen.findByRole("dialog", { name: es.ledger.form.spaceTitle });
    await userEvent.click(within(sheet).getByRole("button", { name: /Household/ }));
    await waitFor(() => expect(spa.location()).toBe(`/spaces/sp-household/new?returnTo=${returnTo}`));
    expect(await screen.findByRole("button", { name: /^Espacio: Household/ })).toBeVisible();
    expect(screen.getByLabelText(es.ledger.form.amount)).toHaveValue("25.000");
    expect(screen.getByLabelText(es.ledger.form.description)).toHaveValue("Farmacia");
    // The amount never travels in the address, and what depends on the space starts afresh.
    expect(spa.location()).not.toContain("25");
    expect(document.querySelector('button[aria-pressed="true"]')).toBeNull();
  });

  it("creates a category in the form's space from its picker, chooses it, and reads the space's tree again (P308)", async () => {
    let tree = rowContext.groups;
    // A MEMBER, who does not manage the tree, creates one (P308).
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ role: "MEMBER" })] }),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: tree }),
      "POST /api/v1/spaces/{spaceId}/categories": async (request) => {
        const body = await request.clone().json();
        const made = categoryDto({ id: "c-hotel", ...body });
        tree = tree.map((g) => (g.id === body.groupId ? { ...g, categories: [...g.categories, made] } : g));
        return jsonResponse(made, 201);
      },
    });
    const spa = renderSpa("/spaces/sp-household/new", routes);
    await userEvent.type(await screen.findByLabelText(es.ledger.form.amount), "45000");
    // Ruling P308: the space is named first, above the kind tabs.
    expect(screen.getByText(es.ledger.form.recordIn)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: es.ledger.form.chooseCategory }));
    const picker = await screen.findByRole("dialog", { name: es.categories.picker.title });
    expect(within(picker).getByText("Categorías de Household")).toBeVisible();
    await userEvent.click(within(picker).getByRole("button", { name: es.categories.picker.new }));
    const sheet = await screen.findByRole("dialog", { name: es.categories.picker.new });
    await userEvent.type(
      await within(sheet).findByLabelText(es.categories.picker.name),
      "Bebidas en el hotel",
    );
    const reads = calls(spa.requests, "GET", /\/sp-household\/categories/).length;
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear y usar en el gasto" }));
    expect(await screen.findByRole("button", { name: "Bebidas en el hotel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls(spa.requests, "POST", /\/sp-household\/categories$/)).toHaveLength(1);
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/sp-household\/categories/).length).toBeGreaterThan(reads),
    );
    expect(screen.getByLabelText(es.ledger.form.amount)).toHaveValue("45.000");
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
    // The record route is a stacked screen (ruling P291): no bottom bar around it.
    expect(screen.queryByRole("navigation", { name: es.shell.nav.main })).not.toBeInTheDocument();
  });

  it("offers a member of a shared space to add guests from Registrar's split sheet (ruling P309)", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ role: "MEMBER" })] }),
    });
    renderSpa("/spaces/sp-household/new", routes);
    await userEvent.click(await screen.findByRole("button", { name: /^Pagó/ }, { timeout: 5_000 }));
    const sheet = await screen.findByRole("dialog", { name: es.ledger.split.title }, { timeout: 10_000 });
    await userEvent.click(within(sheet).getByRole("button", { name: new RegExp(es.ledger.split.addGuests) }));
    expect(
      await screen.findByRole("dialog", { name: "Agregar invitados a Household" }, { timeout: 10_000 }),
    ).toBeVisible();
  });

  it("draws the form as a sheet over the stacked shell for a member who records (ruling P291)", async () => {
    const { routes } = ledgerApi({
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ role: "MEMBER" })] }),
    });
    renderSpa("/spaces/sp-household/new", routes);
    expect(await screen.findByRole("button", { name: es.ledger.form.save.EXPENSE })).toBeVisible();
    expect(screen.getByRole("region", { name: es.ledger.form.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: es.common.back })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
    expect(screen.queryByRole("navigation", { name: es.shell.nav.main })).not.toBeInTheDocument();
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

describe("the personal Inicio is the person's hub (ruling P310, #274)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A monthly space's period holding `from`. */
  const monthOf = (from: string) => {
    const [year, month] = from.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return { label: `${year}-${mm}`, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${last}` };
  };
  const hubApi = (overrides: Record<string, FakeHandler> = {}) =>
    ledgerApi({
      "GET /api/v1/spaces/{spaceId}/periods": (request) =>
        jsonResponse({ items: [monthOf(new URL(request.url).searchParams.get("from")!)] }),
      "GET /api/v1/spaces/{spaceId}/transactions": (request) => {
        const asked = new URL(request.url).searchParams.get("period");
        // The API refuses a period that is no label (ValidationFailed); any other month answers empty.
        if (asked !== null && !/^\d{4}-\d{2}$/.test(asked)) return problemResponse(422, "ValidationFailed");
        return jsonResponse(
          asked === null || asked === "2026-10"
            ? octoberPage
            : { ...octoberPage, period: monthOf(`${asked}-01`), items: [] },
        );
      },
      "GET /api/v1/me/unified-view": (request) =>
        jsonResponse(
          e74Unified({
            period: monthOf(`${new URL(request.url).searchParams.get("period")!}-01`),
            bySpace: [
              {
                space: { id: "sp-personal", name: "Personal", kind: "PERSONAL", color: "GRAPHITE" },
                consumed: { amount: "150000", currency: "COP" },
                paid: { amount: "150000", currency: "COP" },
                categories: [
                  {
                    id: "c-groceries",
                    name: "Groceries",
                    color: null,
                    amount: { amount: "150000", currency: "COP" },
                  },
                ],
              },
              {
                space: { id: "sp-household", name: "Household", kind: "SHARED", color: "TEAL" },
                consumed: { amount: "90000", currency: "COP" },
                paid: { amount: "0", currency: "COP" },
              },
            ],
          }),
        ),
      "GET /api/v1/me/activity": () => jsonResponse({ items: [] }),
      ...overrides,
    }).routes;

  it("steps back from the current period, and cannot step past it", async () => {
    renderSpa("/spaces/sp-personal", hubApi());
    expect(await screen.findByRole("link", { name: es.home.period.previous })).toHaveAttribute(
      "href",
      "/spaces/sp-personal?period=2026-09",
    );
    expect(screen.getByRole("button", { name: es.home.period.next })).toBeDisabled();
    expect(screen.getByText("octubre 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: es.home.accounts })).toBeVisible();
  });

  it("shows a past period's month and movements, without today's balances, and steps forward to the current one", async () => {
    const spa = renderSpa("/spaces/sp-personal?period=2026-09", hubApi());
    expect(await screen.findByRole("heading", { name: "En septiembre" })).toBeVisible();
    expect(screen.getByText("septiembre 2026")).toBeInTheDocument();
    // The current period is the plain address, as the API answers it.
    expect(screen.getByRole("link", { name: es.home.period.next })).toHaveAttribute(
      "href",
      "/spaces/sp-personal",
    );
    expect(screen.getByRole("link", { name: es.home.period.previous })).toHaveAttribute(
      "href",
      "/spaces/sp-personal?period=2026-08",
    );
    expect(screen.getByRole("link", { name: es.home.allTransactions })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-09",
    );
    expect(screen.queryByRole("heading", { name: es.home.accounts })).not.toBeInTheDocument();
    await settled(spa);
    expect(calls(spa.requests, "GET", /\/transactions\?period=2026-09&limit=6$/)).toHaveLength(1);
    expect(calls(spa.requests, "GET", /\/me\/unified-view\?period=2026-09$/)).toHaveLength(1);
    expect(calls(spa.requests, "GET", /\/me\/activity\?from=2026-09-01&to=2026-09-30&limit=6$/)).toHaveLength(
      1,
    );
  });

  it("shows the current period for a `?period=` that is no period, rather than an error", async () => {
    const spa = renderSpa("/spaces/sp-personal?period=octubre", hubApi());
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    expect(screen.getByText("octubre 2026")).toBeInTheDocument();
    await settled(spa);
    expect(calls(spa.requests, "GET", /\/transactions\?/).map((r) => new URL(r.url).search)).toEqual([
      "?limit=6",
    ]);
  });

  it("keeps today's balances on a period after today's, which is not past", async () => {
    renderSpa("/spaces/sp-personal?period=2026-12", hubApi());
    expect(await screen.findByText("diciembre 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: es.home.recent })).toBeVisible();
    expect(screen.getByRole("heading", { name: es.home.accounts })).toBeVisible();
  });

  it("opens each part's movements: a category in the personal space, a space in its own period", async () => {
    const user = userEvent.setup({ advanceTimers: () => undefined });
    renderSpa("/spaces/sp-personal", hubApi());
    const summary = await screen.findByRole("region", { name: es.home.summary });
    await user.click(await within(summary).findByRole("button", { name: new RegExp(es.home.solo) }));
    expect(within(summary).getByRole("link", { name: /Groceries/ })).toHaveAttribute(
      "href",
      // Its amount counts its subcategory, Vegetables, so the list asks for both.
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries%2Cc-veg",
    );
    await user.click(within(summary).getByRole("button", { name: new RegExp(es.home.withOthers) }));
    expect(await within(summary).findByRole("link", { name: /Household/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions?period=2026-10",
    );
  });

  it("names a category opened with its subcategories by the category, and asks the API for all of them", async () => {
    vi.useRealTimers();
    const spa = renderSpa(
      "/spaces/sp-personal/transactions?category=c-groceries%2Cc-veg",
      ledgerApi().routes,
    );
    expect(await screen.findByRole("heading", { level: 1, name: es.ledger.list.title })).toBeVisible();
    expect(
      calls(spa.requests, "GET", /\/transactions\?categoryIds=c-groceries(,|%2C)c-veg&limit=50$/),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Groceries/ })).toBeVisible();
  });

  /** The line dashboard of the period asked for, with the E7 plan's lines unless `withPlan` is false. */
  const linesOf =
    (withPlan = true): FakeHandler =>
    (request) =>
      jsonResponse(
        e7Dashboard({
          spaceId: "sp-personal",
          period: monthOf(`${new URL(request.url).searchParams.get("period")!}-01`),
          ...(withPlan ? {} : { plan: null, lines: [] }),
        }),
      );
  const planCard = () => screen.queryByRole("link", { name: /^Tu plan de/ });

  it("shows the period's plan under its figure in the first paint, opening the personal Plan screen (P311)", async () => {
    const spa = renderSpa(
      "/spaces/sp-personal",
      hubApi({ "GET /api/v1/spaces/{spaceId}/reports/lines": linesOf() }),
    );
    const summary = await screen.findByRole("region", { name: es.home.summary });
    // Read before the screen draws: it is there with the figure, so it never moves what is under it.
    const card = planCard()!;
    expect(card).toHaveAttribute("href", "/spaces/sp-personal/plan");
    expect(card).toHaveTextContent(/^Tu plan de octubre/);
    expect(summary.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await settled(spa);
    expect(calls(spa.requests, "GET", /\/spaces\/sp-personal\/reports\/lines\?period=2026-10$/)).toHaveLength(
      1,
    );
  });

  it("opens a past period's plan at that period (P311)", async () => {
    renderSpa(
      "/spaces/sp-personal?period=2026-09",
      hubApi({ "GET /api/v1/spaces/{spaceId}/reports/lines": linesOf() }),
    );
    expect(await screen.findByRole("heading", { name: "En septiembre" })).toBeVisible();
    expect(planCard()).toHaveAttribute("href", "/spaces/sp-personal/plan?period=2026-09");
    expect(planCard()).toHaveTextContent(/^Tu plan de septiembre/);
  });

  it("shows no plan card for a period without a plan, nor on a shared space's home (P311)", async () => {
    const routes = hubApi({ "GET /api/v1/spaces/{spaceId}/reports/lines": linesOf(false) });
    const spa = renderSpa("/spaces/sp-personal", routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(spa);
    expect(planCard()).toBeNull();
    spa.unmount();
    renderSpa("/spaces/sp-household", hubApi({ "GET /api/v1/spaces/{spaceId}/reports/lines": linesOf() }));
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    expect(screen.queryByRole("link", { name: /plan de/ })).toBeNull();
  });
});

describe("the record form asks before discarding what was typed (#215, F9)", () => {
  const FORM = "/spaces/sp-personal/new";
  const HOME = "/spaces/sp-personal";
  const discard = es.ledger.form.discard;
  const openForm = async (spa: ReturnType<typeof renderSpa>) => {
    // The form's route loads lazily; the first test of the file pays for its import.
    expect(
      await screen.findByRole("button", { name: es.ledger.form.save.EXPENSE }, { timeout: 5_000 }),
    ).toBeVisible();
    await settled(spa);
  };
  const back = () => userEvent.click(screen.getByRole("link", { name: es.common.back }));

  it("closes an untouched form at once, as before", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa(FORM, routes);
    await openForm(spa);
    await back();
    await waitFor(() => expect(spa.location()).toBe(HOME));
    expect(screen.queryByRole("dialog", { name: discard.title.EXPENSE })).not.toBeInTheDocument();
  });

  it("asks before Volver discards a typed amount: Seguir editando keeps it, Descartar leaves", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa(FORM, routes);
    await openForm(spa);
    await userEvent.type(screen.getByLabelText(es.ledger.form.amount), "55000");
    await back();
    const dialog = await screen.findByRole("dialog", { name: discard.title.EXPENSE });
    expect(spa.location()).toBe(FORM);
    await userEvent.click(within(dialog).getByRole("button", { name: discard.keep }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: discard.title.EXPENSE })).not.toBeInTheDocument(),
    );
    expect(spa.location()).toBe(FORM);
    expect(screen.getByLabelText(es.ledger.form.amount)).toHaveValue("55.000");

    await back();
    const again = await screen.findByRole("dialog", { name: discard.title.EXPENSE });
    await userEvent.click(within(again).getByRole("button", { name: discard.confirm }));
    await waitFor(() => expect(spa.location()).toBe(HOME));
  });

  it("asks for an income too, with only a description typed, and names its kind", async () => {
    const { routes } = ledgerApi();
    const spa = renderSpa(`${FORM}?type=income`, routes);
    expect(await screen.findByRole("button", { name: es.ledger.form.save.INCOME })).toBeVisible();
    await settled(spa);
    await userEvent.type(screen.getByLabelText(es.ledger.form.description), "Salario");
    await back();
    expect(await screen.findByRole("dialog", { name: discard.title.INCOME })).toBeVisible();
    expect(spa.location()).toBe(`${FORM}?type=income`);
  });

  it("asks before the system back discards a typed amount, on the browser's own history", async () => {
    window.history.replaceState(null, "", HOME);
    const history = createBrowserHistory();
    const { api } = fakeApi(ledgerApi().routes);
    const spa = createSpa({ history, apisFor: () => ({ api, sessionApi: api }) });
    const view = render(<spa.Spa />);
    try {
      expect(
        await screen.findByRole("heading", { name: es.home.recent }, { timeout: 5_000 }),
      ).toBeInTheDocument();
      await spa.router.navigate({ href: FORM });
      expect(
        await screen.findByRole("button", { name: es.ledger.form.save.EXPENSE }, { timeout: 5_000 }),
      ).toBeVisible();
      await userEvent.type(screen.getByLabelText(es.ledger.form.amount), "55000");

      window.history.back();
      const dialog = await screen.findByRole("dialog", { name: discard.title.EXPENSE });
      await userEvent.click(within(dialog).getByRole("button", { name: discard.keep }));
      await waitFor(() => expect(window.location.pathname).toBe(FORM));
      expect(screen.getByLabelText(es.ledger.form.amount)).toHaveValue("55.000");

      window.history.back();
      const again = await screen.findByRole("dialog", { name: discard.title.EXPENSE });
      await userEvent.click(within(again).getByRole("button", { name: discard.confirm }));
      await waitFor(() => expect(spa.router.state.location.pathname).toBe(HOME));
      expect(window.location.pathname).toBe(HOME);
    } finally {
      view.unmount();
      history.destroy();
      window.history.replaceState(null, "", "/");
    }
  });

  it("never asks once the movement is saved", async () => {
    const { routes } = ledgerApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse({ ...octoberPage.items[0]!, id: "t-new", warnings: [] }, 201),
    });
    const spa = renderSpa(FORM, routes);
    await openForm(spa);
    await userEvent.type(screen.getByLabelText(es.ledger.form.amount), "55000");
    await userEvent.click(screen.getByRole("button", { name: es.ledger.form.save.EXPENSE }));
    await waitFor(() => expect(spa.location()).toBe(`${HOME}/transactions`));
    expect(screen.queryByRole("dialog", { name: discard.title.EXPENSE })).not.toBeInTheDocument();
  });
});

describe("the record sheet draws the screen it was opened from behind it, from the cache (P300, #240)", () => {
  const HOME = "/spaces/sp-personal";
  const discard = es.ledger.form.discard;
  const behind = () => screen.findByTestId("record-backdrop", {}, { timeout: 5_000 });
  const openForm = async (spa: ReturnType<typeof renderSpa>) => {
    expect(
      await screen.findByRole("button", { name: es.ledger.form.save.EXPENSE }, { timeout: 5_000 }),
    ).toBeVisible();
    await settled(spa);
  };
  const record = () => userEvent.click(within(nav()).getByRole("link", { name: es.shell.nav.record }));

  it("draws Inicio under the scrim, inert and hidden from assistive technology, and the form still closes back", async () => {
    const spa = renderSpa(HOME, ledgerApi().routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(spa);
    const before = spa.requests.length;

    await record();
    await openForm(spa);

    const backdrop = await behind();
    expect(backdrop).toHaveAttribute("inert");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(within(backdrop).getByRole("heading", { name: es.home.recent, hidden: true })).toBeInTheDocument();
    // Hidden from assistive technology: a person reaches only the form.
    expect(screen.queryByRole("heading", { name: es.home.recent })).not.toBeInTheDocument();
    // It comes before the scrim, so the scrim and the sheet lie over it.
    expect(
      backdrop.compareDocumentPosition(screen.getByTestId("record-scrim")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Drawn from what Inicio already read: no page, account or category is read again for it.
    const after = spa.requests.slice(before);
    expect(calls(after, "GET", /\/transactions/)).toHaveLength(0);
    expect(calls(after, "GET", /\/categories\?archived=true$/)).toHaveLength(0);

    await userEvent.type(screen.getByLabelText(es.ledger.form.amount), "55000");
    expect(screen.getByLabelText(es.ledger.form.amount)).toHaveValue("55.000");
    await userEvent.click(screen.getByRole("link", { name: es.common.back }));
    const dialog = await screen.findByRole("dialog", { name: discard.title.EXPENSE });
    await userEvent.click(within(dialog).getByRole("button", { name: discard.confirm }));
    await waitFor(() => expect(spa.location()).toBe(HOME));
    expect(screen.queryByTestId("record-backdrop")).not.toBeInTheDocument();
  });

  it("draws Movimientos behind it when the sheet was opened there, under the list's own filter", async () => {
    const spa = renderSpa(`${HOME}/transactions?period=2026-10`, ledgerApi().routes);
    expect(await screen.findByText("Salary")).toBeVisible();
    await settled(spa);
    const before = spa.requests.length;

    await record();
    await openForm(spa);

    const backdrop = await behind();
    expect(
      within(backdrop).getByRole("heading", { level: 1, name: es.ledger.list.title, hidden: true }),
    ).toBeInTheDocument();
    expect(within(backdrop).getByText("Salary")).toBeInTheDocument();
    expect(calls(spa.requests.slice(before), "GET", /\/transactions/)).toHaveLength(0);
  });

  it("draws the space's Inicio behind it for any other origin", async () => {
    const spa = renderSpa(HOME, ledgerApi().routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(spa);

    await spa.router.navigate({ href: `${HOME}/new?returnTo=${encodeURIComponent(`${HOME}/accounts`)}` });
    await openForm(spa);

    const backdrop = await behind();
    expect(within(backdrop).getByRole("heading", { name: es.home.recent, hidden: true })).toBeInTheDocument();
  });

  it("loads no backdrop for a deep link whose screen is not in the cache, and reads nothing for it", async () => {
    const spa = renderSpa(
      `${HOME}/new?returnTo=${encodeURIComponent(`${HOME}/transactions`)}`,
      ledgerApi().routes,
    );
    await openForm(spa);

    // A cold load has no movements in the cache, so the frame and its chunks never download (ADR 0004's record budget).
    await settled(spa);
    expect(screen.queryByTestId("record-backdrop")).not.toBeInTheDocument();
    expect(calls(spa.requests, "GET", /\/transactions/)).toHaveLength(0);
    expect(calls(spa.requests, "GET", /\/categories\?archived=true$/)).toHaveLength(0);
  });

  it("moves the save's toast to the top when the sheet opens again, off its save button (P301)", async () => {
    const { routes } = ledgerApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse({ ...octoberPage.items[0]!, id: "t-new", warnings: [] }, 201),
    });
    const spa = renderSpa(HOME, routes);
    expect(await screen.findByRole("heading", { name: es.home.recent })).toBeVisible();
    await settled(spa);
    const region = () => document.querySelector<HTMLElement>("[data-toast-region]")!;

    await record();
    await openForm(spa);
    await userEvent.type(screen.getByLabelText(es.ledger.form.amount), "55000");
    await userEvent.click(screen.getByRole("button", { name: es.ledger.form.save.EXPENSE }));
    expect(await within(region()).findByText(es.ledger.saved.title)).toBeInTheDocument();
    await waitFor(() => expect(spa.location()).toBe(HOME));
    expect(region()).not.toHaveAttribute("data-placement");

    await record();
    await openForm(spa);
    await waitFor(() => expect(region()).toHaveAttribute("data-placement", "top"));
  });
});
