import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import { budgetFailures } from "./lighthouse.mjs";

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
});
