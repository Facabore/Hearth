import { describe, expect, it } from "vitest";
import { clockFrom, SystemClock } from "./system-clock";

describe("clockFrom (ruling P133)", () => {
  it("fixes the clock at HEARTH_E2E_FIXED_NOW, else reads the system clock", () => {
    expect(clockFrom("2026-11-01T04:30:00Z").now().toISOString()).toBe("2026-11-01T04:30:00.000Z");
    expect(clockFrom(undefined)).toBeInstanceOf(SystemClock);
  });
});
