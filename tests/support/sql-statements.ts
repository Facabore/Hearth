import pg from "pg";

/**
 * Counts the SQL statements this process sends to PostgreSQL while `run` is pending, by wrapping `pg.Client`'s query
 * (the pool's queries and a transaction's go through it). The texts stay in memory for the test that asked; nothing is
 * logged. Acceptance files run one at a time, so no other request shares the count.
 */
export const statementsDuring = async <T>(
  run: () => Promise<T>,
): Promise<{ result: T; statements: string[] }> => {
  const statements: string[] = [];
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = prototype.query;
  prototype.query = function (this: unknown, ...args: unknown[]) {
    const [first] = args;
    statements.push(
      typeof first === "string" ? first : String((first as { text?: string } | null)?.text ?? ""),
    );
    return original.apply(this, args);
  };
  try {
    return { result: await run(), statements };
  } finally {
    prototype.query = original;
  }
};
