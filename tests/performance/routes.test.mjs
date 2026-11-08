import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { emptyStateIn, EMPTY_STATES, measuredUrl, routeUrl } from "./lighthouse.mjs";
import { MEASURED_PERIOD, SEEDED_PERIODS } from "./seed-plan.mjs";

/**
 * Ruling P221 (amended by P242): the caps of the Plan routes; each budget is set from its measurement under them. The
 * owner raised the views' caps (190–195) and the planner's (200) on 2026-10-28 for the SPA's cold load (ADR 0004), and
 * the views' (205) and the trends' (305) on 2026-11-02 for #77's recurring screens (ADR 0004), and Capacidades' (218) on
 * 2026-11-06 for #264 (ADR 0004).
 */
const CAPS = {
  "/spaces/:shared/plan": 205,
  "/spaces/:shared/plan/members": 205,
  "/spaces/:shared/plan/fund": 205,
  "/spaces/:shared/plan/groups": 205,
  "/spaces/:shared/plan/trend": 305,
  "/spaces/:shared/plans/:plan": 210,
  "/spaces/:shared/plans/:plan/capacities": 218,
  "/spaces/:shared/plans/:plan/lines/new": 215,
  "/spaces/:shared/plans/:plan/lines/:line": 215,
  "/spaces/:id/plan": 205,
  "/spaces/:id/plan/lines": 205,
  "/spaces/:id/plan/groups": 205,
  "/spaces/:id/plan/trend": 305,
  "/spaces/:id/plan/calendar": 205,
};

const ROUTES = readFileSync(join("src", "spa", "routes.tsx"), "utf8");

/** Every page of the Plan tab and the planner the SPA routes, as a budget route with its space left as `:space`. */
const planPages = () =>
  [...ROUTES.matchAll(/path: "(plans?(?:\/[^"]*)?)"/g)].map(([, path]) =>
    `/spaces/:space/${path}`.replace("$planId", ":plan").replace("$lineId", ":line"),
  );

describe("the Plan routes' budgets (rulings P221, P242)", () => {
  it("fills the plan and line of a planner route, and refuses one it was not given", () => {
    const ids = { id: "sp-p", shared: "sp-h", plan: "p-oct", line: "l-home" };
    expect(routeUrl("/spaces/:shared/plans/:plan/lines/:line", ids)).toBe(
      "/spaces/sp-h/plans/p-oct/lines/l-home",
    );
    expect(routeUrl("/spaces/:id/plan/calendar", ids)).toBe("/spaces/sp-p/plan/calendar");
    expect(() => routeUrl("/spaces/:shared/plans/:plan", { id: "sp-p", shared: "sp-h" })).toThrow(
      "No id for :plan in /spaces/:shared/plans/:plan",
    );
  });

  it("budgets every Plan route, each within its cap", () => {
    const planRoutes = Object.keys(budgets.scriptKb).filter((route) => /\/plans?(\/|$)/.test(route));
    expect(planRoutes.sort()).toEqual(Object.keys(CAPS).sort());
    for (const [route, cap] of Object.entries(CAPS)) {
      expect(budgets.scriptKb[route], route).toBeGreaterThan(0);
      expect(budgets.scriptKb[route], route).toBeLessThanOrEqual(cap);
    }
  });

  it("measures every page of the Plan tab and the planner in a space that serves it", () => {
    const pages = planPages();
    expect(pages.length).toBeGreaterThanOrEqual(11);
    expect(pages).toContain("/spaces/:space/plans/:plan/lines/:line");
    for (const page of pages)
      expect(
        ["id", "shared"].some((space) => page.replace(":space", `:${space}`) in budgets.scriptKb),
        page,
      ).toBe(true);
  });

  /**
   * Issue #236 (ruling P283): Lighthouse's Chrome keeps the wall clock, so a Plan view opened without `?period=` showed
   * the period of the day it ran, which the seed holds no plan for.
   */
  it("measures every Plan view on the seeded ACTIVE period, whatever day the run is", () => {
    expect(MEASURED_PERIOD).toBe(SEEDED_PERIODS.at(-1));
    const ids = { id: "sp-p", shared: "sp-h", plan: "p-oct", line: "l-home", period: MEASURED_PERIOD };
    const views = Object.keys(CAPS).filter(
      (route) => /\/plan(\/|$)/.test(route) && !route.endsWith("/calendar"),
    );
    expect(views).toHaveLength(9);
    for (const route of views)
      expect(measuredUrl(route, ids), route).toBe(`${routeUrl(route, ids)}?period=${MEASURED_PERIOD}`);
    // Próximos counts from the server's own today (its clock is fixed); the planner names its plan by id.
    for (const route of ["/spaces/:id/plan/calendar", "/spaces/:shared/plans/:plan/lines/:line", "/sign-in"])
      expect(measuredUrl(route, ids), route).toBe(routeUrl(route, ids));
  });

  it("names the empty or no-plan state a page shows, so the run fails instead of measuring it", () => {
    expect(emptyStateIn("Plan\nTendencia\nEste período no tiene plan: no hay rubros que comparar.")).toBe(
      "reports.trend.noPlan",
    );
    // Ruling P311: the empty plan names whose plan is missing.
    expect(emptyStateIn("Plan\nAún no tienes un plan para octubre 2026\nCrear plan")).toBe(
      "reports.noPlan.titlePersonal",
    );
    expect(emptyStateIn("Plan\nHogar aún no tiene un plan para octubre 2026\nCrear plan")).toBe(
      "reports.noPlan.titleShared",
    );
    expect(emptyStateIn("Plan\nThis plan has no lines yet.")).toBe("budgeting.planner.empty");
    expect(emptyStateIn("Nothing is scheduled in the next 30 days.")).toBe("reports.calendar.empty");
    expect(emptyStateIn("Plan\nOctubre 2026\nMercado\nGastado $ 120.000 de $ 1.470.000")).toBeNull();
    expect(EMPTY_STATES.length).toBeGreaterThanOrEqual(6);
  });
});
