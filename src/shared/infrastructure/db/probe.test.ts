import { describe, expect, it } from "vitest";
import { singleFlight } from "./probe";

describe("singleFlight (#190)", () => {
  it("shares the call in flight with every caller that arrives while it runs", async () => {
    let calls = 0;
    let answer: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      answer = resolve;
    });
    const run = singleFlight(() => {
      calls++;
      return pending;
    });
    const first = run();
    const second = run();
    answer("ok");
    expect(await Promise.all([first, second])).toEqual(["ok", "ok"]);
    expect(calls).toBe(1);
  });

  it("starts a new call once the last one settled, even when it failed", async () => {
    let calls = 0;
    const run = singleFlight(async () => {
      calls++;
      if (calls === 1) throw new Error("refused");
      return calls;
    });
    await expect(run()).rejects.toThrow("refused");
    expect(await run()).toBe(2);
    expect(calls).toBe(2);
  });

  it("turns a call that throws at once into a rejection", async () => {
    const run = singleFlight((): Promise<never> => {
      throw new Error("no pool");
    });
    await expect(run()).rejects.toThrow("no pool");
  });
});
