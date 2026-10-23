import { describe, expect, it } from "vitest";
import { periodName } from "./period-name";

describe("periodName (HU-E9-01 home)", () => {
  it("names a calendar month by its month and any other period by its dates", () => {
    expect(
      periodName(
        { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
        { kind: "MONTHLY", day: 1 },
      ),
    ).toEqual({ kind: "month", month: 10, year: 2026 });
    expect(
      periodName(
        { label: "2026-10", startDate: "2026-10-25", endDate: "2026-11-24" },
        { kind: "MONTHLY", day: 25 },
      ),
    ).toEqual({ kind: "range", start: "2026-10-25", end: "2026-11-24" });
  });
});
