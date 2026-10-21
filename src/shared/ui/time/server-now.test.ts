import { describe, expect, it } from "vitest";
import { serverNow } from "./server-now";

describe("serverNow (ruling P133)", () => {
  it("is the e2e instant when HEARTH_E2E_FIXED_NOW is set, else the system clock", () => {
    expect(serverNow({ HEARTH_E2E_FIXED_NOW: "2026-11-01T04:30:00Z" }).toISOString()).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    const before = Date.now();
    expect(serverNow({}).getTime()).toBeGreaterThanOrEqual(before);
  });
});
