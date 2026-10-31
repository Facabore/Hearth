import { Pool } from "pg";
import { reachableWithin } from "./reachable";

/** HU-E8-02, #190: how long the health check waits for the database, under the Docker HEALTHCHECK's 3 s timeout. */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;

/** One call at a time: a caller that arrives while one runs shares its answer instead of starting another. */
export const singleFlight = <T>(run: () => Promise<T>): (() => Promise<T>) => {
  let inFlight: Promise<T> | undefined;
  return () => {
    inFlight ??= Promise.resolve()
      .then(run)
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
};

/**
 * #190: the health check's database probe, on a one-connection pool of its own so it never waits behind application
 * traffic nor adds waiters to it. Health checks that arrive while a probe is out share that probe, so a hung database
 * holds one query at most, and `statement_timeout` (with the client's own `query_timeout` for a silent network) ends it.
 */
export const createDatabaseProbe = (
  url: string,
  { timeoutMs = HEALTH_PROBE_TIMEOUT_MS, query = "SELECT 1" }: { timeoutMs?: number; query?: string } = {},
) => {
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    // The process lives as long as the application's pool, so an idle probe connection never holds it open on exit.
    allowExitOnIdle: true,
  });
  // An idle probe connection that drops is reported by the next probe, not as an unhandled error.
  pool.on("error", () => undefined);
  const probe = singleFlight(() => pool.query(query));
  return {
    pool,
    reachable: () => reachableWithin(timeoutMs, probe),
    close: () => pool.end(),
  };
};
