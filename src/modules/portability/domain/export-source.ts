import type { LocalDate, PeriodPolicy } from "@/shared/kernel";

/**
 * What the export reads of one space, before anything is hidden (design §3.6). The reader fills it from the other
 * modules' use cases; `exportDocument` decides what the person may see of it (D9).
 */
export interface ExportSpaceSource {
  readonly id: string;
  readonly name: string;
  readonly kind: "PERSONAL" | "SHARED" | "DIRECT";
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: string | null;
  readonly archived: boolean;
  readonly members: readonly ExportMemberSource[];
  /** The space's own accounts: a personal space's accounts, a shared space's funds. */
  readonly accounts: readonly ExportAccountSource[];
  readonly categoryGroups: readonly ExportGroupSource[];
  readonly movements: readonly ExportMovementSource[];
  readonly recurrences: readonly ExportRecurrenceSource[];
  readonly plans: readonly ExportPlanSource[];
}

export interface ExportMemberSource {
  readonly id: string;
  readonly displayName: string;
  readonly role: string | null;
  readonly guest: boolean;
  /** Whether this member is the person exporting. */
  readonly you: boolean;
  /**
   * False for a member who left or was removed (D15): their row stays for the history, so their payments and shares
   * still carry their name, but they are not listed among the space's members.
   */
  readonly current: boolean;
}

export interface ExportAccountSource {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly openingBalance: bigint;
  readonly terms: ExportTerms;
  readonly archived: boolean;
}

export interface ExportTerms {
  readonly creditLimit: bigint | null;
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  readonly monthlyRatePpm: number | null;
  readonly annualRatePpm: number | null;
  readonly termDays: number | null;
  readonly maturityDate: LocalDate | null;
  readonly principal: bigint | null;
  readonly termMonths: number | null;
}

export interface ExportGroupSource {
  readonly id: string;
  readonly name: string;
  readonly key: string | null;
  readonly archived: boolean;
  readonly categories: readonly ExportCategorySource[];
}

export interface ExportCategorySource {
  readonly id: string;
  readonly name: string;
  readonly key: string | null;
  readonly archived: boolean;
  readonly subcategories: readonly Omit<ExportCategorySource, "subcategories">[];
}

export type ExportMovementType = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT" | "ADJUSTMENT";

export interface ExportMovementSource {
  readonly id: string;
  readonly type: ExportMovementType;
  readonly date: LocalDate;
  readonly occurredAt: Date | null;
  readonly timeZone: string | null;
  readonly description: string;
  readonly categoryId: string | null;
  readonly amount: bigint;
  readonly currency: string;
  /** An expense's payments: a member (null for the fund) and the account it left. */
  readonly payments: readonly {
    readonly memberId: string | null;
    readonly accountId: string | null;
    readonly amount: bigint;
  }[];
  readonly shares: readonly {
    readonly memberId: string;
    readonly amount: bigint;
    readonly splitMethod: string;
  }[];
  /** A transfer's or settlement's payer; null for an own transfer. */
  readonly payerMemberId: string | null;
  /** An income's or settlement's receiver. */
  readonly receivingMemberId: string | null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  /** A settlement's reason (PAYMENT, GIFT, FORGIVENESS); null for every other type. */
  readonly settlementReason: string | null;
}

export interface ExportRecurrenceSource {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly mode: string;
  readonly schedule: PeriodPolicy;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  readonly status: string;
  readonly nextOccurrence: LocalDate | null;
  readonly categoryId: string | null;
  readonly payerMemberId: string | null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}

export interface ExportPlanSource {
  readonly id: string;
  readonly period: { readonly label: string; readonly start: LocalDate; readonly end: LocalDate };
  readonly status: string;
  readonly currency: string;
  readonly lines: readonly {
    readonly id: string;
    readonly name: string;
    /** The line's budget in the space currency; 0 without one (ruling P342, S7). */
    readonly plannedAmount: bigint;
    /** Ruling P342 (S7): every budget of the line, one per currency, in its order. */
    readonly budgets: readonly { readonly currency: string; readonly amount: bigint }[];
    readonly funding: string;
    readonly rolloverMode: string;
    readonly isCatchAll: boolean;
    readonly allocationRule: string;
    readonly categoryIds: readonly string[];
    readonly payerMemberIds: readonly string[];
  }[];
}
