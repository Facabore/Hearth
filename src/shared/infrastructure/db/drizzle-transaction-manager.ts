import { AsyncLocalStorage } from "node:async_hooks";
import type { DomainError, Err, Result, TransactionManager } from "@/shared/kernel";
import type { Database, Executor } from "./client";

/** Carries an `Err` out of Drizzle's transaction callback, which only rolls back on a throw. */
class RollbackForResult extends Error {
  constructor(readonly result: Err<DomainError>) {
    super("rollback requested by an Err result");
  }
}

export class DrizzleTransactionManager implements TransactionManager {
  private readonly storage = new AsyncLocalStorage<Executor>();

  constructor(private readonly db: Database) {}

  /** The open transaction of the current async context, or the database. */
  executor(): Executor {
    return this.storage.getStore() ?? this.db;
  }

  async run<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.storage.getStore()) return work();
    try {
      return await this.db.transaction((tx) =>
        this.storage.run(tx, async () => {
          const result = await work();
          if (!result.ok) throw new RollbackForResult(result);
          return result;
        }),
      );
    } catch (error) {
      if (error instanceof RollbackForResult) return error.result;
      throw error;
    }
  }
}
