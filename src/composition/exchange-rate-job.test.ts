import { describe, expect, it, vi } from "vitest";
import type { ExchangeRateRepository, ExchangeRateSource, StoredRate } from "@/modules/rates/application";
import type { Logger } from "@/shared/http";
import { FixedClock, ok, err, domainError, type Scheduler } from "@/shared/kernel";
import {
  logExchangeRateJobFailure,
  startExchangeRateJob,
  type ExchangeRateJobDeps,
} from "./exchange-rate-job";

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
    // History is already there unless a test says otherwise, so a run only fetches the day.
    earliestDate: async () => "2010-01-01" as never,
  };
  return { repository, saved };
};

const source = (
  key: string,
  fetch: ExchangeRateSource["fetch"],
  history: ExchangeRateSource["history"] = async () => ok([]),
): ExchangeRateSource => ({ key, fetch, history });

const logger: Logger = { info: vi.fn(), error: vi.fn() };

const depsWith = (sources: ExchangeRateSource[], repository: ExchangeRateRepository, scheduler: Scheduler) =>
  ({
    sources,
    repository,
    scheduler,
    clock: new FixedClock(new Date("2026-11-14T06:00:00Z")),
    logger,
    historyFrom: "2015-01-01" as never,
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

  it("isolates a source whose save throws: the next source still runs, and the failure names its source", async () => {
    const { scheduler, run } = capturingScheduler();
    const saved: StoredRate[] = [];
    const flaky: ExchangeRateRepository = {
      save: async (rates) => {
        if (rates[0]?.source === "ecb") throw new Error("db down");
        saved.push(...rates);
      },
      rateOn: async () => err(domainError("NoExchangeRate", {})),
      earliestDate: async () => "2010-01-01" as never,
    };
    const ecb = source("ecb", async () =>
      ok({
        source: "ecb",
        base: "EUR",
        date: "2026-11-13" as never,
        rates: [{ quote: "USD", rate: "1.1052" }],
      }),
    );
    const trm = source("trm", async () =>
      ok({
        source: "trm",
        base: "USD",
        date: "2026-11-14" as never,
        rates: [{ quote: "COP", rate: "3316.7" }],
      }),
    );
    vi.mocked(logger.error).mockClear();
    startExchangeRateJob(depsWith([ecb, trm], flaky, scheduler), 86_400_000);
    await expect(run()).resolves.toBeUndefined();

    expect(saved.map((r) => [r.source, r.quote])).toEqual([["trm", "COP"]]);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith("exchange_rate_source_failed", {
      source: "ecb",
      name: "Error",
    });
  });

  it("logs a database failure's SQLSTATE and constraint through failureOf, never its message", () => {
    const log: Logger = { info: vi.fn(), error: vi.fn() };
    const cause = Object.assign(new Error("duplicate key value violates ..."), {
      code: "23505",
      constraint: "x",
    });
    logExchangeRateJobFailure(log)(new Error("insert failed", { cause }));
    expect(vi.mocked(log.error)).toHaveBeenCalledWith("exchange_rate_job_failed", {
      name: "Error",
      code: "23505",
      constraint: "x",
    });
  });

  it("stores only rates that are exact positive decimals between known currencies, and logs how many it left out", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository, saved } = recordingRepository();
    const ecb = source("ecb", async () =>
      ok({
        source: "ecb",
        base: "EUR",
        date: "2026-11-13" as never,
        rates: [
          { quote: "USD", rate: "1.1052" },
          { quote: "XYZ", rate: "2" },
          { quote: "MXN", rate: "0" },
        ],
      }),
    );
    vi.mocked(logger.info).mockClear();
    startExchangeRateJob(depsWith([ecb], repository, scheduler), 86_400_000);
    await run();

    expect(saved.map((r) => [r.quote, r.rate])).toEqual([["USD", "1.1052"]]);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith("exchange_rates_saved", {
      source: "ecb",
      date: "2026-11-13",
      count: 1,
      skipped: 2,
    });
  });

  it("fills in a source's history from historyFrom once, before its day, when it has no rate that old", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository, saved } = recordingRepository();
    const empty: ExchangeRateRepository = { ...repository, earliestDate: async () => null };
    const asked: string[] = [];
    const trm = source(
      "trm",
      async () =>
        ok({
          source: "trm",
          base: "USD",
          date: "2026-11-14" as never,
          rates: [{ quote: "COP", rate: "3316.7" }],
        }),
      async (from) => {
        asked.push(from);
        return ok([
          {
            source: "trm",
            base: "USD",
            date: "2015-01-02" as never,
            rates: [{ quote: "COP", rate: "2392.46" }],
          },
          { source: "trm", base: "USD", date: "2015-01-03" as never, rates: [{ quote: "COP", rate: "0" }] },
        ]);
      },
    );
    vi.mocked(logger.info).mockClear();
    startExchangeRateJob(depsWith([trm], empty, scheduler), 86_400_000);
    await run();

    expect(asked).toEqual(["2015-01-01"]);
    expect(saved.map((r) => [r.date, r.rate])).toEqual([
      ["2015-01-02", "2392.46"],
      ["2026-11-14", "3316.7"],
    ]);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith("exchange_rates_backfilled", {
      source: "trm",
      from: "2015-01-01",
      days: 2,
      count: 1,
      skipped: 1,
    });
  });

  it("does not read a source's history again once it starts within a week of historyFrom (holidays publish none)", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository } = recordingRepository();
    const history = vi.fn(async () => ok([]));
    const ecb = source(
      "ecb",
      async () =>
        ok({
          source: "ecb",
          base: "EUR",
          date: "2026-11-13" as never,
          rates: [{ quote: "USD", rate: "1.1052" }],
        }),
      history,
    );
    startExchangeRateJob(
      depsWith([ecb], { ...repository, earliestDate: async () => "2015-01-02" as never }, scheduler),
      86_400_000,
    );
    await run();
    expect(history).not.toHaveBeenCalled();
  });

  it("reads a source's history again when its earliest rate starts more than a week after historyFrom", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository } = recordingRepository();
    const history = vi.fn(async () => ok([]));
    const trm = source(
      "trm",
      async () =>
        ok({
          source: "trm",
          base: "USD",
          date: "2026-11-14" as never,
          rates: [{ quote: "COP", rate: "3316.7" }],
        }),
      history,
    );
    startExchangeRateJob(
      depsWith([trm], { ...repository, earliestDate: async () => "2015-01-09" as never }, scheduler),
      86_400_000,
    );
    await run();
    expect(history).toHaveBeenCalledWith("2015-01-01");
  });

  it("still stores the day when a source's history cannot be read, and tries the history again next run", async () => {
    const { scheduler, run } = capturingScheduler();
    const { repository, saved } = recordingRepository();
    const ecb = source(
      "ecb",
      async () =>
        ok({
          source: "ecb",
          base: "EUR",
          date: "2026-11-13" as never,
          rates: [{ quote: "USD", rate: "1.1052" }],
        }),
      async () => err(domainError("ExchangeRateSourceUnavailable", { source: "ecb" })),
    );
    vi.mocked(logger.info).mockClear();
    startExchangeRateJob(
      depsWith([ecb], { ...repository, earliestDate: async () => null }, scheduler),
      86_400_000,
    );
    await run();
    expect(saved.map((r) => r.date)).toEqual(["2026-11-13"]);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith("exchange_rate_history_unavailable", {
      source: "ecb",
      code: "ExchangeRateSourceUnavailable",
    });
  });

  it("still stores the day when saving the history throws, and names that failure apart", async () => {
    const { scheduler, run } = capturingScheduler();
    const saved: StoredRate[] = [];
    const repository: ExchangeRateRepository = {
      save: async (rates) => {
        if (rates.some((r) => r.date === "2015-01-02")) throw new Error("statement timeout");
        saved.push(...rates);
      },
      rateOn: async () => err(domainError("NoExchangeRate", {})),
      earliestDate: async () => null,
    };
    const trm = source(
      "trm",
      async () =>
        ok({
          source: "trm",
          base: "USD",
          date: "2026-11-14" as never,
          rates: [{ quote: "COP", rate: "3316.7" }],
        }),
      async () =>
        ok([
          {
            source: "trm",
            base: "USD",
            date: "2015-01-02" as never,
            rates: [{ quote: "COP", rate: "2392.46" }],
          },
        ]),
    );
    vi.mocked(logger.error).mockClear();
    startExchangeRateJob(depsWith([trm], repository, scheduler), 86_400_000);
    await run();
    expect(saved.map((r) => r.date)).toEqual(["2026-11-14"]);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith("exchange_rate_history_failed", {
      source: "trm",
      name: "Error",
    });
  });
});
