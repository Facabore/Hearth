import { describe, expect, it } from "vitest";
import { SystemClock } from "./system-clock";
import { UuidV7IdGenerator } from "./uuid-v7-id-generator";

describe("UuidV7IdGenerator", () => {
  it("generates distinct, time-ordered UUIDv7 ids", () => {
    const ids = new UuidV7IdGenerator();
    const generated = Array.from({ length: 50 }, () => ids.next<"Test">());
    for (const id of generated)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(generated).size).toBe(50);
    expect([...generated].sort()).toEqual(generated);
  });
});

describe("SystemClock", () => {
  it("reads the current time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
