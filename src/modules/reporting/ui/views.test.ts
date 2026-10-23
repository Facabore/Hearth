import { describe, expect, it } from "vitest";
import { viewHref, viewsFor } from "./views";

const shared = { id: "sp-household", kind: "SHARED" } as const;

describe("Plan tab views (ruling P200)", () => {
  it("opens a space's first view on the tab's own page and keeps the period", () => {
    expect(viewsFor("SHARED")).toEqual(["lines", "members", "fund", "groups"]);
    expect(viewsFor("PERSONAL")).toEqual(["lines"]);
    expect(viewHref(shared, "lines")).toBe("/spaces/sp-household/plan");
    expect(viewHref(shared, "fund", "2026-11")).toBe("/spaces/sp-household/plan/fund?period=2026-11");
    expect(viewHref(shared, "lines", "2026-11 H1")).toBe("/spaces/sp-household/plan?period=2026-11%20H1");
    expect(viewHref(shared, "members", "2026-11")).toBe("/spaces/sp-household/plan/members?period=2026-11");
  });
});
