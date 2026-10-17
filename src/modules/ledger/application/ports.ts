import type { SpaceId } from "@/modules/spaces/application";
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

/**
 * HU-E4-06: transactions in a CLOSED plan period never change. The composition root binds it to budgeting's
 * closed-period guard (HU-E6-07).
 */
export interface ClosedPeriodGuard {
  isClosed(spaceId: string, date: LocalDate): Promise<boolean>;
}

/** HU-E6-08: the expense whose default split is asked for. */
export interface DefaultSplitQuery {
  readonly spaceId: SpaceId;
  readonly currency: string;
  readonly categoryId: string;
  readonly date: LocalDate;
  /**
   * The space's current members in join order, as the ledger read them for this very expense: the weights name only
   * these, so a member who joined or left since can never make the split refuse (NotASpaceMember).
   */
  readonly memberIds: readonly string[];
}

/**
 * HU-E6-08, spec 5.3: the BY_ALLOCATION weights of an expense recorded without a split, bound by the composition
 * root to budgeting (the ledger never imports it). Null means EQUAL among every current member: no ACTIVE plan
 * covers the date, the category resolves to no line, or the line is NONE or its allocation does not hold.
 * Weights, when given, are non-empty, name only the query's `memberIds` and are positive: anything else is
 * refused as `InvalidSplit` or `NotASpaceMember` for the whole expense, never replaced by EQUAL.
 */
export interface DefaultSplitSource {
  allocationWeights(
    expense: DefaultSplitQuery,
  ): Promise<readonly { readonly memberId: string; readonly weight: bigint }[] | null>;
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

/** Keyset position in the list order (ruling P43): date, time with untimed rows last, creation, id, all descending. */
export interface TransactionPosition {
  readonly date: LocalDate;
  readonly occurredAt: Date | null;
  readonly createdAt: Date;
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

/** HU-E5-04: a span of dates, open on either side when null. */
export interface HistoryRange {
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
}

/** HU-E5-04: one movement of a member's net balance (E5 balance rule) and their running net after it. */
export interface BalanceMovement {
  readonly transactionId: string;
  readonly type: "EXPENSE" | "SETTLEMENT";
  readonly date: LocalDate;
  readonly description: string;
  /** What it did to the member's net: paid − share of a member-paid expense, + paid or − received of a settlement. */
  readonly change: bigint;
  /** The member's net after it, over every earlier movement of the space. */
  readonly balance: bigint;
}

/** HU-E5-04: the member's net before `from` and their movements within the range, by date, creation and id. */
export interface MemberBalanceHistory {
  readonly opening: bigint;
  readonly entries: readonly BalanceMovement[];
}
