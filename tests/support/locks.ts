import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Result } from "@/shared/kernel";
import { codeOf } from "./fakes";

/**
 * Polls `condition` every 20 ms and throws "gave up waiting for <what>" after 500 polls (about 10 s plus the time the
 * checks take): a bound for a hung test, never a delay a passing test waits for.
 */
export const until = async (what: string, condition: () => Promise<boolean> | boolean): Promise<void> => {
  for (let tries = 0; tries < 500; tries++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`gave up waiting for ${what}`);
};

/** Whether some backend is waiting for a lock that backend `pid` holds. */
export const someoneWaitsFor = async (pool: Pool, pid: number): Promise<boolean> => {
  const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [
    pid,
  ]);
  return rows.length > 0;
};

/**
 * A transaction that stops in `hold()` until another backend queues behind a lock it holds, or until `release()` says
 * the other side finished without queueing; `held` resolves once it stopped there. Both ends are observed events.
 */
export const holder = (tm: DrizzleTransactionManager, pool: Pool) => {
  let released = false;
  let stopped: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const hold = async () => {
    const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number(rows[0]?.pid);
    stopped();
    await until(
      `another backend to queue behind backend ${pid}, or the other side to finish`,
      async () => released || (await someoneWaitsFor(pool, pid)),
    );
  };
  const release = () => {
    released = true;
  };
  return { held, hold, release };
};

/**
 * Waits until `holder` stopped inside `writer`. A writer that settles first never reached its hold (it returned early,
 * was refused, or no longer calls the hooked port), so this fails at once and names that, with the writer's own result
 * or error as the cause, instead of leaving the test to the Vitest timeout.
 */
export const heldBy = async (
  h: { readonly held: Promise<void> },
  writer: Promise<unknown>,
): Promise<void> => {
  await Promise.race([
    h.held,
    writer.then(
      (result) => {
        throw new Error("the writer finished before reaching the hold", { cause: result });
      },
      (reason: unknown) => {
        throw new Error("the writer failed before reaching the hold", { cause: reason });
      },
    ),
  ]);
};

/**
 * Both sides of a race run to the end before any rejection is thrown, so one that fails never leaves the other inside
 * its transaction; returns their values, or throws the first rejection (`a` before `b`) once both have settled.
 */
export const bothSettled = async <A, B>(a: Promise<A>, b: Promise<B>): Promise<[A, B]> => {
  const [first, second] = await Promise.allSettled([a, b]);
  if (first.status === "rejected") throw first.reason;
  if (second.status === "rejected") throw second.reason;
  return [first.value, second.value];
};

/** What a writer that failed reports: the database's own message when there is one, so it reads in the diff. */
const failure = (reason: unknown) => {
  const cause = reason instanceof Error && reason.cause instanceof Error ? reason.cause : reason;
  return `rejected: ${cause instanceof Error ? cause.message : String(cause)}`;
};

/** Lets every writer run to the end; the sorted outcomes are error codes, "ok", or "rejected: <message>". */
export const outcomesOf = async (...writers: Promise<Result<unknown>>[]): Promise<string[]> =>
  (await Promise.allSettled(writers))
    .map((writer) => (writer.status === "fulfilled" ? codeOf(writer.value) : failure(writer.reason)))
    .sort();
