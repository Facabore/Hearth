import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { en, es } from "@/i18n/messages/full";
import { categoryDto, cop, groupDto, meDto, octoberPage, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import {
  cashFlowDto,
  e74Groups,
  e74Unified,
  e7Dashboard,
  e7Fund,
  e7Groups,
  e7Matrix,
  HOUSEHOLD_MEMBERS,
  homeTrend,
  householdDto,
  NOVEMBER,
  referencePlanDto,
  savingsAccountDto,
  sixMonthsTrend,
} from "../../tests/support/ui/plan-dto";
import { loadedAreas, renderSpa, speak, watchMissingMessages } from "../../tests/support/ui/spa";

const HOUSEHOLD = "/spaces/sp-household";
const PERSONAL = "/spaces/sp-personal";

/** Ana's personal space and Household in November 2026, over a fake /api/v1 with every Plan report. */
const server = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [NOVEMBER] }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
  "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(e7Dashboard()),
  "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => jsonResponse(e7Fund()),
  "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
  "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": () => jsonResponse(e7Groups()),
  "GET /api/v1/spaces/{spaceId}/reports/trend": () => jsonResponse(homeTrend()),
  "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
  "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(e74Groups()),
  "GET /api/v1/me/trend": () => jsonResponse(sixMonthsTrend()),
  "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto()),
  "GET /api/v1/spaces/{spaceId}/plans/{planId}": (_, { planId }) =>
    planId === "p-nov" ? jsonResponse(referencePlanDto()) : problemResponse(404, "PlanNotFound"),
  "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () =>
    problemResponse(404, "SuggestionNotFound"),
  "PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities": () =>
    jsonResponse(referencePlanDto({ version: 8 })),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [savingsAccountDto()], totals: { available: cop(0), netWorth: cop(0) } }),
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
});

/** The problems shown: alerts with something to say (the views keep an empty live region for announcements). */
const problems = () =>
  screen
    .queryAllByRole("alert")
    .map((alert) => alert.textContent?.trim())
    .filter(Boolean);

const count = (requests: Request[], method: string, path: RegExp) =>
  requests.filter((r) => r.method === method && path.test(new URL(r.url).pathname)).length;

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the Plan tab and the planner in the SPA (slice 5 of #199, ADR 0006)", () => {
  it("opens a shared space's Plan tab on its Lines, with the desktop overview of a period that has a plan (P200, P216)", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plan`, server());
    // The first screen of the file also waits for its modules to be transformed, which a browser never does.
    await waitFor(() => expect(document.title).toBe(`${es.reports.title} · Hearth`), { timeout: 5_000 });
    await waitFor(() => expect(count(spa.requests, "GET", /\/reports\/lines$/)).toBe(1));
    await waitFor(() => expect(count(spa.requests, "GET", /\/reports\/member-matrix$/)).toBe(1));
    expect(problems()).toEqual([]);
    expect(count(spa.requests, "GET", /\/me\/unified-view$/)).toBe(0);
  });

  it("leaves out an overview part that keeps failing, after one more try, and shows the rest (P216)", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plan`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => problemResponse(503, "ServiceUnavailable"),
    });
    await waitFor(() => expect(count(spa.requests, "GET", /\/reports\/member-matrix$/)).toBe(2), {
      timeout: 5_000,
    });
    await waitFor(() => expect(count(spa.requests, "GET", /\/reports\/fund-contributions$/)).toBe(1));
    expect(problems()).toEqual([]);
  });

  it("opens the personal space's Plan tab on Rubros, with its views in U3's order and no Mi consumo (ruling P267)", async () => {
    const spa = renderSpa(`${PERSONAL}/plan?period=2026-11`, server());
    const tabs = await screen.findByRole("navigation", { name: es.reports.tabs.label }, { timeout: 5_000 });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((tab) => tab.textContent),
    ).toEqual([
      es.reports.view.lines,
      es.reports.view.groups,
      es.reports.view.trend,
      es.reports.view.calendar,
    ]);
    expect(within(tabs).getByRole("link", { name: es.reports.view.lines })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(count(spa.requests, "GET", /\/reports\/lines$/)).toBeGreaterThanOrEqual(1);
    expect(count(spa.requests, "GET", /\/me\/unified-view$/)).toBe(0);
    // The old address stays the Plan tab's own page: nothing redirects, and its period is kept.
    expect(spa.router.state.location.href).toBe(`${PERSONAL}/plan?period=2026-11`);
    expect(problems()).toEqual([]);
  });

  it("shows Mi consumo as a stacked screen with its way back home and its period (U10, U4, ruling P267)", async () => {
    const spa = renderSpa(`${PERSONAL}/my-consumption?period=2026-11`, server());
    await waitFor(() => expect(document.title).toBe(`${es.reports.view.mine} · Hearth`), { timeout: 5_000 });
    expect(await screen.findByRole("link", { name: es.common.back })).toHaveAttribute("href", PERSONAL);
    expect(screen.getByRole("heading", { level: 1, name: es.reports.view.mine })).toBeVisible();
    expect(screen.getByRole("region", { name: es.reports.unified.spent })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: es.reports.tabs.label })).toBeNull();
    expect(count(spa.requests, "GET", /\/me\/unified-view$/)).toBe(1);
    expect(problems()).toEqual([]);
  });

  it("answers Mi consumo in a shared space with the not-found screen, since it is the personal space's", async () => {
    renderSpa(`${HOUSEHOLD}/my-consumption`, server());
    expect(await screen.findByRole("heading", { name: es.notFound.title }, { timeout: 5_000 })).toBeVisible();
  });

  it.each([
    [`${HOUSEHOLD}/plan/lines`, es.reports.view.lines, /\/reports\/lines$/],
    [`${HOUSEHOLD}/plan/groups`, es.reports.view.groups, /\/reports\/spending-by-group$/],
    [`${HOUSEHOLD}/plan/trend`, es.reports.view.trend, /\/reports\/trend$/],
    [`${HOUSEHOLD}/plan/fund`, es.reports.view.fund, /\/reports\/fund-contributions$/],
    [`${HOUSEHOLD}/plan/members`, es.reports.view.members, /\/reports\/member-matrix$/],
    // After another title, so the wait sees this screen's own, not Rubros left by the shared space's.
    [`${PERSONAL}/plan/lines`, es.reports.view.lines, /\/reports\/lines$/],
    [`${PERSONAL}/plan/groups`, es.reports.view.groups, /\/me\/reports\/spending-by-group$/],
    [`${PERSONAL}/plan/trend`, es.reports.view.trend, /\/me\/trend$/],
    [`${PERSONAL}/plan/calendar`, es.reports.calendar.metaTitle, /\/me\/cash-flow$/],
  ])("shows %s from its own report", async (url, title, report) => {
    const spa = renderSpa(url, server());
    await waitFor(() => expect(document.title).toBe(`${title} · Hearth`), { timeout: 5_000 });
    expect(count(spa.requests, "GET", report)).toBe(1);
    expect(problems()).toEqual([]);
  });

  it.each([`${PERSONAL}/plan/fund`, `${PERSONAL}/plan/members`, `${HOUSEHOLD}/plan/calendar`])(
    "answers %s, a view the space does not have, with the not-found screen",
    async (url) => {
      renderSpa(url, server());
      expect(
        await screen.findByRole("heading", { name: es.notFound.title }, { timeout: 5_000 }),
      ).toBeVisible();
    },
  );

  it("opens the planner, and a plan that does not exist is not found", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov`, server());
    await waitFor(() => expect(document.title).toBe(`${es.budgeting.planner.metaTitle} · Hearth`), {
      timeout: 5_000,
    });
    await spa.router.navigate({ href: `${HOUSEHOLD}/plans/p-gone` });
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });

  it("shows the plan the address names after moving from another plan's planner (ruling P248)", async () => {
    const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": (_, { planId }) =>
        jsonResponse(referencePlanDto(planId === "p-oct" ? { id: "p-oct", period: OCTOBER } : {})),
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: /noviembre 2026/i }, { timeout: 5_000 }),
    ).toBeVisible();
    await spa.router.navigate({ href: `${HOUSEHOLD}/plans/p-oct` });
    expect(await screen.findByRole("heading", { level: 1, name: /octubre 2026/i })).toBeVisible();
  });

  it("shows the lines of the plan the server answers last, such as a line just added (HU-E9-08)", async () => {
    let lines = referencePlanDto().lines;
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () =>
        jsonResponse(referencePlanDto({ version: 7 + lines.length, lines })),
    });
    await screen.findByRole("listitem", { name: "Rent" }, { timeout: 5_000 });
    lines = [...lines, { ...lines[0]!, id: "l-pets", name: "Mascotas" }];
    await spa.queryClient.invalidateQueries({ queryKey: ["plans", "sp-household"] });
    expect(await screen.findByRole("listitem", { name: "Mascotas" })).toBeVisible();
  });

  it("saves the capacities through a PUT: the plan and its reports are read again, the ledger is not", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/capacities`, server());
    const save = await screen.findByRole("button", { name: "Guardar aportes" }, { timeout: 5_000 });
    const plans = count(spa.requests, "GET", /\/plans\/p-nov$/);
    // Household's Lines and My spending, read earlier in the session: the person's share counts in both (D11).
    spa.queryClient.setQueryData(["reports", "sp-household", "lines", "2026-11"], e7Dashboard());
    spa.queryClient.setQueryData(["reports", "sp-personal", "unified", { period: "2026-11" }], e74Unified());
    // October's Lines, read earlier too: no screen watches it now, so the save leaves it stale.
    spa.queryClient.setQueryData(["reports", "sp-household", "lines", "2026-10"], e7Dashboard());
    const novemberLines = () =>
      spa.requests.filter((request) => {
        const url = new URL(request.url);
        return (
          request.method === "GET" &&
          url.pathname === "/api/v1/spaces/sp-household/reports/lines" &&
          url.searchParams.get("period") === "2026-11"
        );
      }).length;
    const linesBefore = novemberLines();
    await userEvent.click(save);

    await waitFor(() => expect(spa.location()).toBe(`${HOUSEHOLD}/plans/p-nov`));
    await waitFor(() => expect(count(spa.requests, "GET", /\/plans\/p-nov$/)).toBeGreaterThan(plans));
    // The plan's figures are computed on read (D7): the space's reports and the person's own are stale now.
    const stale = (key: readonly unknown[]) => {
      const queries = spa.queryClient.getQueryCache().findAll({ queryKey: key });
      return queries.length > 0 && queries.every((query) => query.state.isInvalidated);
    };
    // #264: the planner itself watches the period's Lines (its "Gastos sin rubro"), so that report is read again at once
    // instead of waiting stale; the person's own reports, which nothing on screen watches, stay marked.
    await waitFor(() => expect(novemberLines()).toBeGreaterThan(linesBefore));
    expect(stale(["reports", "sp-household", "lines", "2026-10"])).toBe(true);
    expect(stale(["reports", "sp-personal"])).toBe(true);
    expect(count(spa.requests, "PUT", /\/capacities$/)).toBe(1);
    expect(count(spa.requests, "GET", /\/transactions$/)).toBe(0);
    // No blanket refresh: the profile, which every screen reads, was never marked stale by the save.
    expect(spa.queryClient.getQueryState(["identity", "me"])?.isInvalidated).toBe(false);
  });

  it("opens the capacities as a sheet over the planner, and its ✕ goes back to the planner (board 04)", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/capacities`, server());
    const sheet = await screen.findByRole(
      "dialog",
      { name: es.budgeting.capacity.title },
      { timeout: 5_000 },
    );
    // The planner stays drawn under the sheet, out of reach while the sheet is open.
    expect(
      screen.getByRole("heading", { level: 1, name: /Plan de noviembre 2026/i, hidden: true }),
    ).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: es.common.close }));
    await waitFor(() => expect(spa.location()).toBe(`${HOUSEHOLD}/plans/p-nov`));
    expect(await screen.findByRole("heading", { level: 1, name: /Plan de noviembre 2026/i })).toBeVisible();
  });

  it("shows the capacities without a suggestion the server keeps failing, after one more try (P208)", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/capacities`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () =>
        problemResponse(503, "ServiceUnavailable"),
    });
    expect(await screen.findByRole("button", { name: "Guardar aportes" }, { timeout: 5_000 })).toBeVisible();
    expect(count(spa.requests, "GET", /\/capacity-suggestion$/)).toBe(2);
    expect(problems()).toEqual([]);
  });

  it("edits a plan's line, and a line that is not the plan's is not found", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/lines/new`, server());
    await waitFor(() => expect(document.title).toBe(`${es.budgeting.lineEditor.newTitle} · Hearth`), {
      timeout: 5_000,
    });
    await spa.router.navigate({ href: `${HOUSEHOLD}/plans/p-nov/lines/l-gone` });
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });
  it("shows a plan's line read-only to someone who may not edit it, with the way back to the planner", async () => {
    renderSpa(`${HOUSEHOLD}/plans/p-nov/lines/new`, {
      ...server(),
      "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdDto({ role: "MEMBER" })] }),
    });
    expect(await screen.findByText(es.budgeting.lineEditor.readOnly, {}, { timeout: 5_000 })).toBeVisible();
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute("href", `${HOUSEHOLD}/plans/p-nov`);
  });
});

describe("an empty plan leads with Crear plan (ruling P311, #275)", () => {
  /** A monthly space's period holding `from`. */
  const monthOf = (from: string) => {
    const [year, month] = from.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return { label: `${year}-${mm}`, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${last}` };
  };
  /** November has no plan; October has one only when `previous` says so. */
  const emptyNovember = (previous: boolean): Record<string, FakeHandler> => ({
    ...server(),
    "GET /api/v1/spaces/{spaceId}/periods": (request) =>
      jsonResponse({ items: [monthOf(new URL(request.url).searchParams.get("from")!)] }),
    "GET /api/v1/spaces/{spaceId}/reports/lines": (request) => {
      const period = monthOf(`${new URL(request.url).searchParams.get("period")!}-01`);
      const planned = previous && period.label === "2026-10";
      return jsonResponse(
        e7Dashboard({ spaceId: "sp-personal", period, ...(planned ? {} : { plan: null, lines: [] }) }),
      );
    },
  });

  it("offers a new person Crear plan alone, and says when a copy will be possible", async () => {
    renderSpa(`${PERSONAL}/plan?period=2026-11`, emptyNovember(false));
    expect(
      await screen.findByRole(
        "heading",
        { level: 2, name: "Aún no tienes un plan para noviembre" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    // The loader read October's dashboard ahead: the line is there with the title, never after it.
    expect(screen.getByText(es.budgeting.start.noPrevious)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /plan/ }).map((button) => button.textContent)).toEqual([
      es.budgeting.start.create,
    ]);
  });

  it("offers the copy second, named by the previous period, when it has a plan", async () => {
    const spa = renderSpa(`${PERSONAL}/plan?period=2026-11`, emptyNovember(true));
    const create = await screen.findByRole("button", { name: es.budgeting.start.create }, { timeout: 5_000 });
    const copy = screen.getByRole("button", { name: "Copiar el plan de octubre" });
    expect(create.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(es.budgeting.start.noPrevious)).toBeNull();
    expect(
      spa.requests.filter((r) => new URL(r.url).search === "?period=2026-10" && /reports\/lines/.test(r.url)),
    ).toHaveLength(1);
  });
});

describe("the Plan views' origins (#240, ruling P272)", () => {
  it("names the categories of Sin presupuesto from the space's categories (board E9-10 01)", async () => {
    renderSpa(`${HOUSEHOLD}/plan/lines?period=2026-11`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(
          e7Dashboard({
            unbudgeted: {
              spent: cop(60_000),
              available: cop(-60_000),
              overspent: true,
              categoryIds: ["c-restaurants"],
            },
          }),
        ),
      "GET /api/v1/spaces/{spaceId}/categories": () =>
        jsonResponse({
          items: [groupDto({ categories: [categoryDto({ id: "c-restaurants", name: "Restaurantes" })] })],
        }),
    });
    expect(
      await screen.findByText(
        "Gastado $ 60.000 en categorías sin rubro · Restaurantes",
        {},
        { timeout: 5_000 },
      ),
    ).toBeVisible();
  });

  it("says where each row of Mi consumo came from, the personal space's own part apart (board E9-11 01)", async () => {
    const personal = { id: "sp-personal", name: "Personal" };
    const home = { id: "sp-household", name: "Hogar" };
    const view = e74Unified();
    const [groceries, rent] = view.consumption.categories;
    view.consumption.categories = [
      { ...groceries!, spaces: [personal, home] },
      { ...rent!, spaces: [home] },
    ];
    renderSpa(`${PERSONAL}/my-consumption?period=2026-11`, {
      ...server(),
      "GET /api/v1/me/unified-view": () => jsonResponse(view),
    });
    expect(await screen.findByText("Personal y Hogar", {}, { timeout: 5_000 })).toBeVisible();
    expect(screen.getByText("Hogar · tu parte")).toBeVisible();
  });

  it("says which spaces each of the person's groups came from (board E9-11 02)", async () => {
    const household = { id: "sp-household", name: "Household" };
    const data = e74Groups();
    data.groups = data.groups.map((group) => ({
      ...group,
      spaces: group.space ? [group.space] : [{ id: "sp-personal", name: "Personal" }, household],
    }));
    renderSpa(`${PERSONAL}/plan/groups?period=2026-11`, {
      ...server(),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(data),
    });
    expect(await screen.findAllByText("Personal y Household", {}, { timeout: 5_000 })).toHaveLength(2);
    expect(screen.getByText("Grupo creado en Household")).toBeVisible();
  });

  it("names the fund the Fondo view tracks after the space (board E9-10 04)", async () => {
    const { container } = renderSpa(`${HOUSEHOLD}/plan/fund?period=2026-11`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () =>
        jsonResponse({ ...e7Fund(), funds: [{ id: "acc-fund", name: "Fondo Hogar" }] }),
    });
    await waitFor(
      () =>
        expect(container.querySelector("[data-frame-subtitle]")?.textContent).toBe("Household · Fondo Hogar"),
      { timeout: 5_000 },
    );
  });
});

describe("the Plan tab's copy, the plan area (ruling P276)", () => {
  it("shows the Plan tab's own copy after a cold load, and in English after a language change", async () => {
    const missing = watchMissingMessages();
    const spa = renderSpa(`${PERSONAL}/plan?period=2026-11`, server());
    expect(
      await screen.findByRole("navigation", { name: es.reports.tabs.label }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["es:plan"]);

    speak(spa, "en");
    expect(await screen.findByRole("navigation", { name: en.reports.tabs.label })).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["en:plan", "es:plan"]);
    expect(missing()).toEqual([]);
  });
});
