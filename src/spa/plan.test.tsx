import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import { cop, meDto, octoberPage, spaceDto } from "../../tests/support/ui/dto";
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
import { renderSpa } from "../../tests/support/ui/spa";

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

  it("opens the personal space's Plan tab on My spending, the person's own (D11)", async () => {
    const spa = renderSpa(`${PERSONAL}/plan`, server());
    await waitFor(() => expect(count(spa.requests, "GET", /\/me\/unified-view$/)).toBe(1), {
      timeout: 5_000,
    });
    expect(await screen.findByRole("link", { name: es.reports.view.calendar })).toBeInTheDocument();
    expect(problems()).toEqual([]);
  });

  it.each([
    [`${HOUSEHOLD}/plan/lines`, es.reports.view.lines, /\/reports\/lines$/],
    [`${HOUSEHOLD}/plan/groups`, es.reports.view.groups, /\/reports\/spending-by-group$/],
    [`${HOUSEHOLD}/plan/trend`, es.reports.view.trend, /\/reports\/trend$/],
    [`${HOUSEHOLD}/plan/fund`, es.reports.view.fund, /\/reports\/fund-contributions$/],
    [`${HOUSEHOLD}/plan/members`, es.reports.view.members, /\/reports\/member-matrix$/],
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

  it("saves the capacities through a PUT: the plan and its reports are read again, the ledger is not", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/capacities`, server());
    const save = await screen.findByRole("button", { name: "Guardar capacidades" }, { timeout: 5_000 });
    const plans = count(spa.requests, "GET", /\/plans\/p-nov$/);
    await userEvent.click(save);

    await waitFor(() => expect(spa.location()).toBe(`${HOUSEHOLD}/plans/p-nov`));
    await waitFor(() => expect(count(spa.requests, "GET", /\/plans\/p-nov$/)).toBeGreaterThan(plans));
    expect(count(spa.requests, "PUT", /\/capacities$/)).toBe(1);
    expect(count(spa.requests, "GET", /\/transactions$/)).toBe(0);
    expect(count(spa.requests, "GET", /\/me$/)).toBe(1);
  });

  it("edits a plan's line, and a line that is not the plan's is not found", async () => {
    const spa = renderSpa(`${HOUSEHOLD}/plans/p-nov/lines/new`, server());
    await waitFor(() => expect(document.title).toBe(`${es.budgeting.lineEditor.newTitle} · Hearth`), {
      timeout: 5_000,
    });
    await spa.router.navigate({ href: `${HOUSEHOLD}/plans/p-nov/lines/l-gone` });
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
  });
});
