import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { budgetFailures, isVisitorRoute, routeUrl } from "./lighthouse.mjs";

describe("performance budgets (ruling P134)", () => {
  it("names every route and metric over its budget, and passes the ones within", () => {
    const results = [
      { route: "/sign-in", lcp: 1800, cls: 0, tbt: 90, scriptKb: 120 },
      { route: "/spaces/:id/new", lcp: 2600, cls: 0.12, tbt: 250, scriptKb: 211 },
    ];
    expect(budgetFailures(results, budgets)).toEqual([
      "/spaces/:id/new: LCP 2600 ms > 2500 ms",
      "/spaces/:id/new: CLS 0.12 > 0.1",
      "/spaces/:id/new: TBT 250 ms > 200 ms",
      "/spaces/:id/new: script 211 KiB > 205 KiB",
    ]);
  });

  it("fails a route with no budget instead of passing it silently", () => {
    expect(budgetFailures([{ route: "/new-route", lcp: 1, cls: 0, tbt: 0, scriptKb: 1 }], budgets)).toEqual([
      "/new-route: no script budget in tests/performance/budgets.json",
    ]);
  });

  it("fills every route of the budgets from the seeded ids, and refuses an id it does not have (ruling P177)", () => {
    const ids = { id: "sp-p", shared: "sp-h", member: "m-j", token: "tok", claim: "clm" };
    for (const route of Object.keys(budgets.scriptKb)) expect(routeUrl(route, ids)).not.toContain(":");
    expect(routeUrl("/spaces/:shared/members/:member/history", ids)).toBe("/spaces/sp-h/members/m-j/history");
    expect(() => routeUrl("/spaces/:nope", ids)).toThrow("No id for :nope in /spaces/:nope");
  });

  it("measures the sign-in, sign-up, invitation and claim pages without a session", () => {
    expect(
      ["/sign-in", "/sign-up", "/invitations/:token", "/claims/:claim", "/spaces/:id", "/spaces/new"].map(
        isVisitorRoute,
      ),
    ).toEqual([true, true, true, true, false, false]);
  });
});
