import type { Account, AccountMovements, AccountRepository } from "@/modules/accounts/application";
import type { LocalDate } from "@/shared/kernel";

export class InMemoryAccounts implements AccountRepository {
  rows: Account[] = [];
  async add(account: Account) {
    this.rows.push(account);
  }
  async addUnlessNameTaken(account: Account) {
    const taken = this.rows.some(
      (a) => a.spaceId === account.spaceId && a.name.toLowerCase() === account.name.toLowerCase(),
    );
    if (!taken) this.rows.push(account);
    return !taken;
  }
  async listBySpace(spaceId: string) {
    return this.rows.filter((a) => a.spaceId === spaceId);
  }
  async findById(accountId: string) {
    return this.rows.find((a) => a.id === accountId) ?? null;
  }
  async save(account: Account) {
    this.rows = this.rows.map((a) => (a.id === account.id ? account : a));
  }
}

/** Fixed net movements per account id; records every `asOf` it was asked for. */
export class FixedMovements implements AccountMovements {
  readonly asked: (LocalDate | null)[] = [];
  constructor(private readonly net: Record<string, bigint> = {}) {}
  async netMovements(accountIds: readonly string[], asOf: LocalDate | null) {
    this.asked.push(asOf);
    return new Map<string, bigint>(accountIds.map((id) => [id, this.net[id] ?? 0n]));
  }
}
