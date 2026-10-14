import type { LocalDate } from "@/shared/kernel";
import type { ChangeSet, Transaction, TransactionType } from "../domain/transaction";

/** What the ledger needs to know about an account; bound to the accounts module. */
export interface LedgerAccount {
  readonly id: string;
  readonly spaceId: string;
  readonly ownerUserId: string | null;
  /** A SHARED_FUND account, recognised by its type (HU-E4-09/10), never by a missing owner. */
  readonly isSharedFund: boolean;
  readonly archived: boolean;
}

export interface AccountReader {
  /** Any account by id, whatever its space; null for unknown or malformed ids. */
  find(accountId: string): Promise<LedgerAccount | null>;
}

/** HU-E4-10: an account's balance (opening balance plus movements) as the requester sees it; bound to the accounts module. */
export interface AccountBalances {
  balanceOf(spaceId: string, userId: string, accountId: string): Promise<bigint>;
}

export interface LedgerCategory {
  readonly id: string;
  readonly archived: boolean;
}

export interface CategoryReader {
  /** A category of the given space, archived ones included; null otherwise. */
  find(spaceId: string, categoryId: string): Promise<LedgerCategory | null>;
}

/** HU-E4-06: transactions in a CLOSED plan period never change. Always open until HU-E6-07. */
export interface ClosedPeriodGuard {
  isClosed(spaceId: string, date: LocalDate): Promise<boolean>;
}

export interface TransactionRepository {
  add(transaction: Transaction): Promise<void>;
  /** A transaction of the space; soft-deleted ones only when asked; null for unknown or malformed ids. */
  findById(spaceId: string, transactionId: string, includeDeleted?: boolean): Promise<Transaction | null>;
  /** Writes `transaction` as version `expectedVersion + 1` only if the stored version is `expectedVersion`. */
  save(transaction: Transaction, expectedVersion: number): Promise<boolean>;
}

export interface AuditEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly action: "UPDATED" | "DELETED";
  readonly actorUserId: string;
  readonly at: Date;
  readonly changes: ChangeSet;
}

export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
  /** Oldest first. */
  listFor(transactionId: string): Promise<AuditEntry[]>;
}

export interface TransactionFilter {
  readonly spaceId: string;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly categoryIds?: readonly string[];
  readonly payerMemberId?: string;
  readonly participantMemberId?: string;
  readonly type?: TransactionType;
}

/** Keyset position in the newest-first order (date desc, id desc). */
export interface TransactionPosition {
  readonly date: LocalDate;
  readonly id: string;
}

export interface TransactionQuery {
  /** Live matching transactions, newest first, strictly after `after`, at most `limit`. */
  list(filter: TransactionFilter, after: TransactionPosition | null, limit: number): Promise<Transaction[]>;
  /** Σ EXPENSE and Σ INCOME amounts of every live matching transaction; transfers are not spending. */
  totals(filter: TransactionFilter): Promise<{ expenses: bigint; income: bigint }>;
}

/**
 * HU-E5-01 (E5 balance rule): per-member sums of one space's live, member-paid expenses and its
 * settlements. Fund-paid expenses and every transfer, fund contributions included, create no debt (D5).
 */
export interface MemberMoneyTotals {
  readonly memberId: string;
  readonly paid: bigint;
  readonly consumed: bigint;
  readonly settledOut: bigint;
  readonly settledIn: bigint;
}
