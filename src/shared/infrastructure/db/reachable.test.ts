import { afterEach, describe, expect, it, vi } from "vitest";
import { reachableWithin } from "./reachable";

afterEach(() => vi.useRealTimers());

describe("reachableWithin (HU-E8-02)", () => {
  it("is true when the probe succeeds and false when it fails", async () => {
    expect(await reachableWithin(2_000, async () => 1)).toBe(true);
    expect(await reachableWithin(2_000, () => Promise.reject(new Error("refused")))).toBe(false);
  });

  it("is false once the time is up for a probe that never answers", async () => {
    vi.useFakeTimers();
    const answer = reachableWithin(2_000, () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await answer).toBe(false);
  });
});
