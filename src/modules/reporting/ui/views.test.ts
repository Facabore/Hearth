import { describe, expect, it } from "vitest";
import { calendarHref, viewHref, viewsFor } from "./views";

const shared = { id: "sp-household", kind: "SHARED" } as const;
const personal = { id: "sp-personal", kind: "PERSONAL" } as const;

describe("Plan tab views (ruling P200)", () => {
  it("opens a space's first view on the tab's own page and keeps the period", () => {
    expect(viewsFor("SHARED")).toEqual(["lines", "members", "fund", "groups", "trend"]);
    expect(viewsFor("PERSONAL")).toEqual(["mine", "calendar", "groups", "trend", "lines"]);
    expect(viewHref(shared, "lines")).toBe("/spaces/sp-household/plan");
    expect(viewHref(shared, "fund", "2026-11")).toBe("/spaces/sp-household/plan/fund?period=2026-11");
    expect(viewHref(shared, "lines", "2026-11 H1")).toBe("/spaces/sp-household/plan?period=2026-11%20H1");
    expect(viewHref(shared, "members", "2026-11")).toBe("/spaces/sp-household/plan/members?period=2026-11");
    expect(viewHref({ id: "sp-personal", kind: "PERSONAL" }, "lines")).toBe("/spaces/sp-personal/plan/lines");
    expect(viewHref({ id: "sp-personal", kind: "PERSONAL" }, "mine", "2026-11")).toBe(
      "/spaces/sp-personal/plan?period=2026-11",
    );
  });

  it("links the calendar without a period, and its windows by days (ruling P241 of M6c)", () => {
    expect(viewHref(personal, "calendar", "2026-11")).toBe("/spaces/sp-personal/plan/calendar");
    expect(calendarHref(personal, 30)).toBe("/spaces/sp-personal/plan/calendar");
    expect(calendarHref(personal, 60)).toBe("/spaces/sp-personal/plan/calendar?days=60");
  });
});
