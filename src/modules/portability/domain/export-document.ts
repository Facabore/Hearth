import { wallTimeIn, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import type {
  ExportAccountSource,
  ExportMemberSource,
  ExportMovementType,
  ExportSpaceSource,
  ExportTerms,
} from "./export-source";

/** The API's wire form of an amount: minor units as a decimal string, and the ISO 4217 code. */
export interface MoneyValue {
  readonly amount: string;
  readonly currency: string;
}

/** A member as the export names them: by display name, never by anything of their own accounts (D9). */
export interface MemberRef {
  readonly memberId: string;
  /** Their display name, a former member's too (D15); null only for an id the space never had. */
  readonly name: string | null;
}

/** An account the person sees: one of their own, or the space's shared fund. */
export interface AccountRef {
  readonly id: string;
  readonly name: string;
}

export interface ExportedCategory {
  readonly id: string;
  readonly name: string;
  readonly key: string | null;
  readonly archived: boolean;
}

export interface ExportedMovement {
  readonly id: string;
  readonly type: ExportMovementType;
  readonly date: LocalDate;
  /** "HH:MM" on the recorder's clock; null for a movement without a time. */
  readonly time: string | null;
  readonly timeZone: string | null;
  /** RFC 3339 instant; null for a movement without a time. */
  readonly occurredAt: string | null;
  readonly description: string;
  readonly category: {
    readonly id: string;
    readonly name: string;
    readonly group: string;
    readonly parent: string | null;
  } | null;
  readonly amount: MoneyValue;
  /**
   * An expense's payments. `account` is null for a payment from outside the person's accounts: another member's
   * personal account shows only that member's name (D9).
   */
  readonly payments: readonly {
    readonly member: MemberRef | null;
    readonly account: AccountRef | null;
    readonly amount: MoneyValue;
  }[];
  readonly shares: readonly {
    readonly member: MemberRef;
    readonly amount: MoneyValue;
    readonly splitMethod: string;
  }[];
  readonly payer: MemberRef | null;
  readonly receiver: MemberRef | null;
  readonly sourceAccount: AccountRef | null;
  readonly destinationAccount: AccountRef | null;
  readonly settlementReason: string | null;
}

export interface ExportedSpace {
  readonly id: string;
  readonly name: string;
  readonly kind: ExportSpaceSource["kind"];
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly role: string | null;
  readonly archived: boolean;
  readonly members: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string | null;
    readonly guest: boolean;
    readonly you: boolean;
  }[];
  readonly accounts: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly currency: string;
    readonly openingBalance: MoneyValue;
    readonly terms: ExportedTerms;
    readonly archived: boolean;
  }[];
  readonly categoryGroups: readonly (ExportedCategory & {
    readonly categories: readonly (ExportedCategory & {
      readonly subcategories: readonly ExportedCategory[];
    })[];
  })[];
  readonly movements: readonly ExportedMovement[];
  readonly recurrences: readonly {
    readonly id: string;
    readonly type: string;
    readonly description: string;
    readonly amount: MoneyValue;
    readonly mode: string;
    readonly schedule: PeriodPolicy;
    readonly startDate: LocalDate;
    readonly endDate: LocalDate | null;
    readonly status: string;
    readonly nextOccurrence: LocalDate | null;
    readonly categoryId: string | null;
    readonly payer: MemberRef | null;
    readonly sourceAccount: AccountRef | null;
    readonly destinationAccount: AccountRef | null;
  }[];
  readonly plans: readonly {
    readonly id: string;
    readonly period: { readonly label: string; readonly startDate: LocalDate; readonly endDate: LocalDate };
    readonly status: string;
    readonly lines: readonly {
      readonly id: string;
      readonly name: string;
      /** The line's budget in the space currency; 0 without one. */
      readonly plannedAmount: MoneyValue;
      /** Ruling P342 (S7): every budget of the line, one per currency, in its order. */
      readonly budgets: readonly MoneyValue[];
      readonly funding: string;
      readonly rolloverMode: string;
      readonly isCatchAll: boolean;
      readonly allocationRule: string;
      readonly categoryIds: readonly string[];
      readonly payers: readonly MemberRef[];
    }[];
  }[];
}

/** Terms as the wire writes them: amounts as money, the rest as stored. */
export type ExportedTerms = Omit<ExportTerms, "creditLimit" | "principal"> & {
  readonly creditLimit: MoneyValue | null;
  readonly principal: MoneyValue | null;
};

/** Design §3.6: Hearth's own export, version 1; also an import source (§3.4). */
export interface ExportDocument {
  readonly format: "hearth-export";
  readonly version: 1;
  readonly exportedAt: string;
  readonly person: { readonly name: string; readonly locale: string; readonly timeZone: string };
  readonly spaces: readonly ExportedSpace[];
}

export interface ExportInput {
  readonly person: ExportDocument["person"];
  readonly exportedAt: Date;
  readonly spaces: readonly ExportSpaceSource[];
  /** The person's own accounts (their personal space's), which name their payments in every space. */
  readonly yourAccounts: readonly ExportAccountSource[];
}

const money = (amount: bigint, currency: string): MoneyValue => ({ amount: amount.toString(), currency });
const twoDigits = (n: number) => String(n).padStart(2, "0");

const timeOf = (occurredAt: Date | null, timeZone: string | null): string | null => {
  if (occurredAt === null || timeZone === null) return null;
  const { hour, minute } = wallTimeIn(occurredAt, timeZone);
  return `${twoDigits(hour)}:${twoDigits(minute)}`;
};

const termsOf = (terms: ExportTerms, currency: string): ExportedTerms => ({
  ...terms,
  creditLimit: terms.creditLimit === null ? null : money(terms.creditLimit, currency),
  principal: terms.principal === null ? null : money(terms.principal, currency),
});

const categoryOf = <T extends { id: string; name: string; key: string | null; archived: boolean }>(
  c: T,
): ExportedCategory => ({ id: c.id, name: c.name, key: c.key, archived: c.archived });

/**
 * One space as the person sees it (D9): their own accounts and the space's funds are named; an account of another
 * member is never named, by id or by name, so a payment from it shows only who paid.
 */
const exportedSpace = (
  space: ExportSpaceSource,
  yourAccounts: readonly ExportAccountSource[],
): ExportedSpace => {
  const visible = new Map<string, AccountRef>(
    [...yourAccounts, ...space.accounts].map((a) => [a.id, { id: a.id, name: a.name }]),
  );
  const account = (id: string | null): AccountRef | null => (id === null ? null : (visible.get(id) ?? null));
  const members = new Map<string, ExportMemberSource>(space.members.map((m) => [m.id, m]));
  const member = (id: string | null): MemberRef | null =>
    id === null ? null : { memberId: id, name: members.get(id)?.displayName ?? null };
  const categories = new Map<string, NonNullable<ExportedMovement["category"]>>();
  for (const group of space.categoryGroups) {
    for (const category of group.categories) {
      categories.set(category.id, { id: category.id, name: category.name, group: group.name, parent: null });
      for (const sub of category.subcategories) {
        categories.set(sub.id, { id: sub.id, name: sub.name, group: group.name, parent: category.name });
      }
    }
  }
  return {
    id: space.id,
    name: space.name,
    kind: space.kind,
    currency: space.currency,
    periodPolicy: space.periodPolicy,
    role: space.role,
    archived: space.archived,
    members: space.members
      .filter((m) => m.current)
      .map((m) => ({
        id: m.id,
        name: m.displayName,
        role: m.role,
        guest: m.guest,
        you: m.you,
      })),
    accounts: space.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      openingBalance: money(a.openingBalance, a.currency),
      terms: termsOf(a.terms, a.currency),
      archived: a.archived,
    })),
    categoryGroups: space.categoryGroups.map((g) => ({
      ...categoryOf(g),
      categories: g.categories.map((c) => ({
        ...categoryOf(c),
        subcategories: c.subcategories.map(categoryOf),
      })),
    })),
    movements: space.movements.map((m) => ({
      id: m.id,
      type: m.type,
      date: m.date,
      time: timeOf(m.occurredAt, m.timeZone),
      timeZone: m.timeZone,
      occurredAt: m.occurredAt?.toISOString() ?? null,
      description: m.description,
      category: m.categoryId === null ? null : (categories.get(m.categoryId) ?? null),
      amount: money(m.amount, m.currency),
      payments: m.payments.map((p) => ({
        member: member(p.memberId),
        account: account(p.accountId),
        amount: money(p.amount, m.currency),
      })),
      shares: m.shares.map((s) => ({
        member: member(s.memberId)!,
        amount: money(s.amount, m.currency),
        splitMethod: s.splitMethod,
      })),
      payer: member(m.payerMemberId),
      receiver: member(m.receivingMemberId),
      sourceAccount: account(m.sourceAccountId),
      destinationAccount: account(m.destinationAccountId),
      settlementReason: m.settlementReason,
    })),
    recurrences: space.recurrences.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      amount: money(r.amount, r.currency),
      mode: r.mode,
      schedule: r.schedule,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      nextOccurrence: r.nextOccurrence,
      categoryId: r.categoryId,
      payer: member(r.payerMemberId),
      sourceAccount: account(r.sourceAccountId),
      destinationAccount: account(r.destinationAccountId),
    })),
    plans: space.plans.map((p) => ({
      id: p.id,
      period: { label: p.period.label, startDate: p.period.start, endDate: p.period.end },
      status: p.status,
      lines: p.lines.map((l) => ({
        id: l.id,
        name: l.name,
        plannedAmount: money(l.plannedAmount, p.currency),
        budgets: l.budgets.map((b) => money(b.amount, b.currency)),
        funding: l.funding,
        rolloverMode: l.rolloverMode,
        isCatchAll: l.isCatchAll,
        allocationRule: l.allocationRule,
        categoryIds: l.categoryIds,
        payers: l.payerMemberIds.map((id) => member(id)!),
      })),
    })),
  };
};

/** Design §3.6: what the person can see in Hearth, nothing more, as Hearth's JSON export (version 1). */
export const exportDocument = (input: ExportInput): ExportDocument => ({
  format: "hearth-export",
  version: 1,
  exportedAt: input.exportedAt.toISOString(),
  person: input.person,
  spaces: input.spaces.map((space) => exportedSpace(space, input.yourAccounts)),
});
