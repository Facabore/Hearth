import type { Result } from "./result";

export interface TransactionManager {
  /**
   * Runs `work` in one database transaction. An `Err` result or a thrown error rolls
   * everything back. Nested calls join the outer transaction, so only the outermost
   * result decides whether it commits.
   */
  run<T>(work: () => Promise<Result<T>>): Promise<Result<T>>;
}
