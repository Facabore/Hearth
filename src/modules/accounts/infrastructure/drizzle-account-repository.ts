import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type { AccountRepository } from "../application/account-repository";
import type { Account, AccountId } from "../domain/account";
import { accounts } from "./accounts.schema";

const toAccount = (row: typeof accounts.$inferSelect): Account => {
  const {
    creditLimit,
    cutOffDay,
    paymentDay,
    monthlyRatePpm,
    annualRatePpm,
    termDays,
    maturityDate,
    principal,
    termMonths,
    ...rest
  } = row;
  return {
    ...rest,
    id: row.id as AccountId,
    terms: {
      creditLimit,
      cutOffDay,
      paymentDay,
      monthlyRatePpm,
      annualRatePpm,
      termDays,
      maturityDate: maturityDate as LocalDate | null,
      principal,
      termMonths,
    },
  };
};

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(account: Account): Promise<void> {
    await this.tm
      .executor()
      .insert(accounts)
      .values({
        id: account.id,
        spaceId: account.spaceId,
        name: account.name,
        type: account.type,
        ownerUserId: account.ownerUserId,
        openingBalance: account.openingBalance,
        archivedAt: account.archivedAt,
        createdAt: account.createdAt,
        institution: account.institution,
        lastFour: account.lastFour,
        color: account.color,
        icon: account.icon,
        ...account.terms,
      });
  }

  async listBySpace(spaceId: string): Promise<Account[]> {
    const rows = await this.tm.executor().select().from(accounts).where(eq(accounts.spaceId, spaceId));
    return rows.map(toAccount);
  }

  async findById(accountId: string): Promise<Account | null> {
    // Ids come from request bodies and URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(accountId)) return null;
    const [row] = await this.tm.executor().select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return row ? toAccount(row) : null;
  }

  async save(account: Account): Promise<void> {
    await this.tm
      .executor()
      .update(accounts)
      .set({
        name: account.name,
        openingBalance: account.openingBalance,
        archivedAt: account.archivedAt,
        institution: account.institution,
        lastFour: account.lastFour,
        color: account.color,
        icon: account.icon,
        ...account.terms,
      })
      .where(eq(accounts.id, account.id));
  }
}
