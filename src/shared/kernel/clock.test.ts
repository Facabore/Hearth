import { describe, expect, it } from "vitest";
import { FixedClock, todayIn } from "./clock";

describe("todayIn", () => {
  it("computes today in the space timezone", () => {
    const clock = new FixedClock(new Date("2026-11-01T04:30:00Z"));
    expect(todayIn(clock, "America/Bogota")).toBe("2026-10-31");
    expect(todayIn(clock, "UTC")).toBe("2026-11-01");
  });

  it("returns a fresh Date so callers cannot mutate the fixed instant", () => {
    const clock = new FixedClock(new Date("2026-11-01T00:00:00Z"));
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
