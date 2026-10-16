import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerScheduler } from "./timer-scheduler";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TimerScheduler (HU-E4-12, P20)", () => {
  it("runs the job at once, then every interval after each run ends", async () => {
    let runs = 0;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      runs += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    stop();
    expect(runs).toBe(3);
  });

  it("never starts a run while the previous one is still going", async () => {
    let running = 0;
    let most = 0;
    let finish: () => void = () => undefined;
    const stop = new TimerScheduler(() => undefined).every(10, async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      running -= 1;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect([running, most]).toEqual([1, 1]);
    finish();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    expect(most).toBe(1);
  });

  it("waits the whole interval after a run that took long, counted from when it ended", async () => {
    const startedAt: number[] = [];
    let finish: () => void = () => undefined;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      startedAt.push(Date.now());
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    finish();
    await vi.advanceTimersByTimeAsync(999);
    expect(startedAt).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    stop();
    expect(startedAt).toHaveLength(2);
    expect(startedAt[1]! - startedAt[0]!).toBe(6000);
  });

  it("reports a job that throws and runs it again on the next tick", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const stop = new TimerScheduler((error) => errors.push(error)).every(1000, async () => {
      runs += 1;
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    expect([runs, errors.length]).toEqual([2, 2]);
  });

  it("keeps running when reporting a failure throws too", async () => {
    let runs = 0;
    let reports = 0;
    const stop = new TimerScheduler(() => {
      reports += 1;
      throw new Error("the reporter is broken");
    }).every(1000, async () => {
      runs += 1;
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    expect([runs, reports]).toEqual([3, 3]);
  });

  it("runs nothing after stop()", async () => {
    let runs = 0;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      runs += 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(1);
  });

  it("does not schedule another run when stop() is called while a run is going", async () => {
    let runs = 0;
    let finish: () => void = () => undefined;
    const stop = new TimerScheduler(() => undefined).every(1000, async () => {
      runs += 1;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(1);
  });
});
