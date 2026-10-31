import { afterAll, describe, expect, inject, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { someoneWaitsFor, until } from "../../../../tests/support/locks";
import { createDatabaseProbe } from "./probe";

// A hung database, made deterministic: the probe's query waits for an advisory lock a test session holds.
const KEY = 190_001;
const HUNG_QUERY = `SELECT pg_advisory_xact_lock_shared(${KEY})`;
const { pool } = testDatabase();
afterAll(() => pool.end());

const holdLock = async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [KEY]);
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  return {
    pid: Number(rows[0]!.pid),
    release: async () => {
      await client.query("COMMIT");
      client.release();
    },
  };
};

/** How many backends wait behind the lock holder `pid`. */
const waitingBehind = async (pid: number) => {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
    [pid],
  );
  return Number(rows[0]!.n);
};

describe("the health check's database probe (#190)", () => {
  it("answers true while PostgreSQL answers", async () => {
    const probe = createDatabaseProbe(inject("databaseUrl"));
    try {
      expect(await probe.reachable()).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it("keeps one query against a hung database however many health checks arrive", async () => {
    const lock = await holdLock();
    const probe = createDatabaseProbe(inject("databaseUrl"), { timeoutMs: 5_000, query: HUNG_QUERY });
    try {
      const first = probe.reachable();
      await until("the probe to queue behind the lock", () => someoneWaitsFor(pool, lock.pid));
      const more = Array.from({ length: 5 }, () => probe.reachable());
      expect(await waitingBehind(lock.pid)).toBe(1);
      expect(probe.pool.totalCount).toBe(1);
      expect(probe.pool.waitingCount).toBe(0);
      await lock.release();
      expect(await Promise.all([first, ...more])).toEqual([true, true, true, true, true, true]);
    } finally {
      await probe.close();
    }
  });

  it("answers false in bounded time and lets the database cancel the hung query", async () => {
    const lock = await holdLock();
    const probe = createDatabaseProbe(inject("databaseUrl"), { timeoutMs: 300, query: HUNG_QUERY });
    try {
      expect(await probe.reachable()).toBe(false);
      // statement_timeout cancels the query server-side, so the lock has no one waiting behind it any more.
      await until("the hung probe to be cancelled", async () => (await waitingBehind(lock.pid)) === 0);
      await lock.release();
      expect(await probe.reachable()).toBe(true);
    } finally {
      await probe.close();
    }
  });
});
