import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { routeUrl } from "./lighthouse.mjs";

/** Ruling P221 (amended by P242): the caps of the Plan routes; each budget is set from its measurement under them. */
const CAPS = {
  "/spaces/:shared/plan": 195,
  "/spaces/:shared/plan/members": 190,
  "/spaces/:shared/plan/fund": 190,
  "/spaces/:shared/plan/groups": 195,
  "/spaces/:shared/plan/trend": 300,
  "/spaces/:shared/plans/:plan": 200,
  "/spaces/:shared/plans/:plan/capacities": 200,
  "/spaces/:shared/plans/:plan/lines/new": 215,
  "/spaces/:shared/plans/:plan/lines/:line": 215,
  "/spaces/:id/plan": 190,
  "/spaces/:id/plan/lines": 190,
  "/spaces/:id/plan/groups": 195,
  "/spaces/:id/plan/trend": 300,
  "/spaces/:id/plan/calendar": 190,
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
});
