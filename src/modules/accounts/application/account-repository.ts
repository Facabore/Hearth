import type { Account } from "../domain/account";

export interface AccountRepository {
  add(account: Account): Promise<void>;
  /** Every account of the space, archived ones included. */
  listBySpace(spaceId: string): Promise<Account[]>;
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  findById(accountId: string): Promise<Account | null>;
  /** Persists name, opening balance and archive state. */
  save(account: Account): Promise<void>;
}
