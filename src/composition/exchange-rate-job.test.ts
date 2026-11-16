import { describe, expect, it, vi } from "vitest";
import type { ExchangeRateRepository, ExchangeRateSource, StoredRate } from "@/modules/rates/application";
import type { Logger } from "@/shared/http";
import { FixedClock, ok, err, domainError, type Scheduler } from "@/shared/kernel";
import { startExchangeRateJob, type ExchangeRateJobDeps } from "./exchange-rate-job";

const capturingScheduler = () => {
  const ticks: Array<() => Promise<void>> = [];
  const scheduler: Scheduler = {
    every: (_intervalMs, job) => {
      ticks.push(job as () => Promise<void>);
      return () => {};
    },
  };
  return { scheduler, run: () => ticks[0]!() };
};

const recordingRepository = () => {
  const saved: StoredRate[] = [];
  const repository: ExchangeRateRepository = {
    save: async (rates) => {
      saved.push(...rates);
    },
    rateOn: async () => err(domainError("NoExchangeRate", {})),
  };
  return { repository, saved };
};

const source = (key: string, fetch: ExchangeRateSource["fetch"]): ExchangeRateSource => ({ key, fetch });

const logger: Logger = { info: vi.fn(), error: vi.fn() };

const depsWith = (sources: ExchangeRateSource[], repository: ExchangeRateRepository, scheduler: Scheduler) =>
  ({
    sources,
    repository,
    scheduler,
    clock: new FixedClock(new Date("2026-11-14T06:00:00Z")),
    logger,
  }) satisfies ExchangeRateJobDeps;

describe("startExchangeRateJob", () => {
  it("stores each ok source's rates with the fetch instant and source key", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository, saved } = recordingRepository();
    const ecb = source("ecb", async () =>
      ok({
        source: "ecb",
        base: "EUR",
        date: "2026-11-13" as never,
        rates: [
          { quote: "USD", rate: "1.1052" },
          { quote: "MXN", rate: "20.5491" },
        ],
      }),
    );
    startExchangeRateJob(depsWith([ecb], repository, scheduler), 86_400_000);
    await run();

    expect(saved).toEqual([
      {
        date: "2026-11-13",
        base: "EUR",
        quote: "USD",
        rate: "1.1052",
        source: "ecb",
        fetchedAt: new Date("2026-11-14T06:00:00Z"),
      },
      {
        date: "2026-11-13",
        base: "EUR",
        quote: "MXN",
        rate: "20.5491",
        source: "ecb",
        fetchedAt: new Date("2026-11-14T06:00:00Z"),
      },
    ]);
  });

  it("skips an unavailable source and still runs the others", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository, saved } = recordingRepository();
    const down = source("ecb", async () =>
      err(domainError("ExchangeRateSourceUnavailable", { source: "ecb" })),
    );
    const trm = source("trm", async () =>
      ok({
        source: "trm",
        base: "USD",
        date: "2026-11-14" as never,
        rates: [{ quote: "COP", rate: "3316.7" }],
      }),
    );
    startExchangeRateJob(depsWith([down, trm], repository, scheduler), 86_400_000);
    await run();

    expect(saved).toEqual([
      {
        date: "2026-11-14",
        base: "USD",
        quote: "COP",
        rate: "3316.7",
        source: "trm",
        fetchedAt: new Date("2026-11-14T06:00:00Z"),
      },
    ]);
  });

  it("isolates a source whose save throws", async () => {
    const { scheduler, run } = capturingScheduler();
    const throwing: ExchangeRateRepository = {
      save: async () => {
        throw new Error("db down");
      },
      rateOn: async () => err(domainError("NoExchangeRate", {})),
    };
    const ecb = source("ecb", async () =>
      ok({
        source: "ecb",
        base: "EUR",
        date: "2026-11-13" as never,
        rates: [{ quote: "USD", rate: "1.1052" }],
      }),
    );
    startExchangeRateJob(depsWith([ecb], throwing, scheduler), 86_400_000);
    await expect(run()).resolves.toBeUndefined();
  });
});
