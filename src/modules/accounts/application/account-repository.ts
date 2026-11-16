import type { Account } from "../domain/account";

export interface AccountRepository {
  add(account: Account): Promise<void>;
  /**
   * Issue 169: inserts it unless the space already holds its name (ignoring case), committed or still being inserted
   * by another transaction, which this one then waits for; true when it was inserted. Any other violation still fails.
   */
  addUnlessNameTaken(account: Account): Promise<boolean>;
  /** Every account of the space, archived ones included. */
  listBySpace(spaceId: string): Promise<Account[]>;
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  findById(accountId: string): Promise<Account | null>;
  /**
   * Persists name, opening balance and archive state; false, with nothing written, when another account of the space
   * holds its name (ignoring case), committed or still being written by another transaction, which this one waits for
   * (issue #245).
   */
  save(account: Account): Promise<boolean>;
  /**
   * D29, slice MC3 (HU-E1-03): sets every account of the space to `currency`. A space's currency changes only while it
   * holds no money (SpaceCurrencyLocked), so all its accounts are money-free and not yet fixed, and must follow it.
   */
  retagCurrency(spaceId: string, currency: string): Promise<void>;
  /** Ruling P336: one account's currency with its opening balance and terms, converted into it. */
  saveCurrency(account: Account): Promise<void>;
}
