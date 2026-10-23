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
  /** Persists name, opening balance and archive state. */
  save(account: Account): Promise<void>;
}
