import type { LocalDate, Money } from "@/shared/kernel";

/**
 * The neutral model of another app's data (design §3.1). A `SourceAdapter` only translates a file into one of these;
 * every decision (catalog match, duplicates, balances) lives in the planner. It never reaches the ledger as-is.
 */
export interface SourceSnapshot {
  /** Stable key of the app this came from, e.g. "money-manager". */
  readonly sourceApp: string;
  readonly accounts: readonly SourceAccount[];
  readonly categories: readonly SourceCategory[];
  readonly movements: readonly SourceMovement[];
  /** Budgets are not imported in the first version (gap G7, Q6); they are listed so the preview can count them. */
  readonly budgets: readonly SourceBudget[];
  readonly settings: SourceSettings;
  readonly skipped: SkippedCounts;
  /** Rows read with a caveat or left out on purpose (an unpaired transfer row, one side of a transfer at zero). */
  readonly warnings: readonly SourceIssue[];
  /** Rows that could not be read (a malformed amount or date): left out, the rest of the file still imports (§3.2). */
  readonly errors: readonly SourceIssue[];
}

/**
 * One note about one source row, as a stable PascalCase code plus plain data, so the UI words it in the person's
 * language (design §3.2). Never a sentence.
 */
export interface SourceIssue {
  readonly code: string;
  /** The row's source key: Money Manager's `uid`, or `txUidTrans` for a transfer pair. */
  readonly sourceKey: string;
  readonly details?: Readonly<Record<string, string>>;
}

/**
 * The Hearth account types a personal import can produce (design §2.1). Mirrors the accounts module's `ACCOUNT_TYPES`
 * minus `SHARED_FUND`, which a personal import never creates; `account-type-map.test.ts` in application guards drift.
 */
export type SourceAccountType =
  "CASH" | "BANK" | "WALLET" | "CREDIT_CARD" | "SAVINGS" | "INVESTMENT" | "LOAN" | "OTHER";

export interface SourceAccount {
  /** The source's own id (Money Manager `ASSETS.uid`): the import's source key. */
  readonly sourceId: string;
  readonly name: string;
  /** The Hearth type the group maps to (design §2.1). */
  readonly type: SourceAccountType;
  /** ISO 4217 code of the account's currency (D29). */
  readonly currency: string;
  readonly order: number;
  /** Credit-card cut-off day (`CARD_DAY_FIN`); null for a non-card or an unset value. */
  readonly cutOffDay: number | null;
  /** Credit-card payment day (`CARD_DAY_PAY`); null for a non-card or an unset value. */
  readonly paymentDay: number | null;
  readonly memo: string | null;
  /** `ASSETS.ZDATA` flag, meaning unverified (design §1.1): treated as "hidden". */
  readonly hidden: boolean;
  /** `ASSETS.ZDATA2` flag, meaning unverified (design §1.1): treated as "exclude from totals". */
  readonly excludedFromTotals: boolean;
}

/** Money Manager has two levels and a kind; Hearth has three levels and no kind (design §2.2). */
export interface SourceCategory {
  readonly sourceId: string;
  /** The name with any leading emoji removed. */
  readonly name: string;
  /** The leading emoji, kept as the category's icon (D22); null when the name had none. */
  readonly icon: string | null;
  /** `ZCATEGORY.TYPE`: 0 income, 1 expense. */
  readonly kind: "INCOME" | "EXPENSE";
  /** The top-level category this refines; null for a top-level category. */
  readonly parentSourceId: string | null;
  /** A deleted category kept only because a movement still uses it (design §2.2); the planner archives it. */
  readonly deleted: boolean;
  readonly order: number;
}

export type SourceMovementKind = "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";

export interface SourceMovement {
  /** The source's own id: Money Manager's `uid`, or `txUidTrans` for a transfer pair (design §3.3). */
  readonly sourceKey: string;
  readonly kind: SourceMovementKind;
  /** `WDATE`, the calendar date the movement counts in (already local; never derived from a UTC instant). */
  readonly date: LocalDate;
  /** `ZDATE` as an instant; the preview's time zone turns it into `occurredAt` + `timeZone` (design §2.3). */
  readonly occurredAt: Date | null;
  /** The account (`assetUid`); for a transfer, the account money leaves. */
  readonly accountSourceId: string;
  /** The account money reaches in a transfer; null otherwise. */
  readonly toAccountSourceId: string | null;
  readonly categorySourceId: string | null;
  /** The amount in `accountSourceId`'s currency; for a transfer, the amount leaving it. Signed for an adjustment. */
  readonly amount: Money;
  /** What was entered when its currency differs from the account's (design §2.3); null when they match. */
  readonly originalAmount: Money | null;
  /** The amount reaching `toAccountSourceId`, in its own currency; null for a non-transfer. */
  readonly toAmount: Money | null;
  /** The two free-text fields joined by " · ", with the movement's tags as `#tag` (gap G6); null when empty. */
  readonly note: string | null;
}

export interface SourceBudget {
  readonly sourceId: string;
  /** The category the budget is for; null for a total budget. */
  readonly categorySourceId: string | null;
}

export interface SourceSettings {
  /** `ZETC.start_day`, the month-start day, which suggests the space's period policy; null when unset. */
  readonly startDay: number | null;
  /** `CURRENCY.MAIN_ISO`, the file's main currency; null when unknown. */
  readonly mainCurrency: string | null;
}

export interface SkippedCounts {
  /** Movements with a zero amount, skipped and counted (design §2.3). */
  readonly zeroAmountMovements: number;
  /** Deleted categories no movement uses, dropped entirely (design §2.2). */
  readonly deletedCategories: number;
}
