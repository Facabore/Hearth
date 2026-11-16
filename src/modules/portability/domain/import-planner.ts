import { isErr, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { matchCatalog, type CatalogMatch } from "./category-match";
import type { SourceAccount, SourceMovement, SourceMovementKind, SourceSnapshot } from "./source-snapshot";

/** A Hearth movement already present, so a matching source movement is a duplicate (design §3.1, §3.3). */
export interface ExistingMovement {
  readonly accountSourceId: string;
  readonly date: LocalDate;
  readonly amountMinor: bigint;
  readonly kind: SourceMovementKind;
}

export interface PreviewOptions {
  /** The zone chosen for the import; the person's own by default (design §2.3). */
  readonly timeZone: string;
  /** Movements already in Hearth, matched by account, date, amount and kind (design §3.1). */
  readonly existing?: readonly ExistingMovement[];
}

export interface AccountProposal {
  readonly sourceId: string;
  readonly name: string;
  /** The first version always proposes a new account; an existing-account mapping is an interactive edit (design §3.2). */
  readonly mapping: { readonly kind: "new"; readonly type: SourceAccount["type"]; readonly currency: string };
  readonly cutOffDay: number | null;
  readonly paymentDay: number | null;
  /** The account's closing balance in the source, in its own currency (design §3.1). */
  readonly sourceClosingBalance: Money;
}

export type CategoryProposalTarget =
  CatalogMatch | { readonly kind: "subcategory"; readonly parentSourceId: string };

export interface CategoryProposal {
  readonly sourceId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly kind: "INCOME" | "EXPENSE";
  readonly parentSourceId: string | null;
  readonly proposal: CategoryProposalTarget;
  /** A used-but-deleted category is imported archived (design §2.2). */
  readonly archived: boolean;
}

export interface ImportPreview {
  readonly sourceApp: string;
  readonly counts: {
    readonly income: number;
    readonly expense: number;
    readonly transfer: number;
    readonly adjustment: number;
    readonly total: number;
    readonly skippedZero: number;
  };
  readonly dateRange: { readonly first: LocalDate; readonly last: LocalDate } | null;
  readonly accounts: readonly AccountProposal[];
  readonly categories: readonly CategoryProposal[];
  readonly duplicates: readonly { readonly sourceKey: string }[];
  readonly leftOut: { readonly budgets: number; readonly zeroAmountMovements: number };
  readonly warnings: readonly string[];
}

const fingerprint = (
  accountSourceId: string,
  date: LocalDate,
  amountMinor: bigint,
  kind: SourceMovementKind,
): string => `${accountSourceId}|${date}|${amountMinor}|${kind}`;

/** The signed minor-unit change each movement makes to each account's own balance (design §3.1). */
const applyToBalances = (balances: Map<string, bigint>, movement: SourceMovement): void => {
  const bump = (accountId: string, minor: bigint): void => {
    balances.set(accountId, (balances.get(accountId) ?? 0n) + minor);
  };
  switch (movement.kind) {
    case "INCOME":
    case "ADJUSTMENT":
      bump(movement.accountSourceId, movement.amount.minor);
      return;
    case "EXPENSE":
      bump(movement.accountSourceId, -movement.amount.minor);
      return;
    case "TRANSFER":
      bump(movement.accountSourceId, -movement.amount.minor);
      if (movement.toAccountSourceId && movement.toAmount) {
        bump(movement.toAccountSourceId, movement.toAmount.minor);
      }
      return;
  }
};

/**
 * The dry run (design §3.1, §3.2): counts by kind, the date range, a proposed mapping and closing balance for each
 * account, a proposed target for each category, likely duplicates, and what is left out. Pure: it reads nothing and
 * writes nothing. It never throws; a balance whose currency is unknown is the one way it fails (`UnknownCurrency`).
 */
export const previewImport = (snapshot: SourceSnapshot, options: PreviewOptions): Result<ImportPreview> => {
  const counts = { income: 0, expense: 0, transfer: 0, adjustment: 0 };
  let first: LocalDate | null = null;
  let last: LocalDate | null = null;
  const balances = new Map<string, bigint>();

  for (const movement of snapshot.movements) {
    if (movement.kind === "INCOME") counts.income += 1;
    else if (movement.kind === "EXPENSE") counts.expense += 1;
    else if (movement.kind === "TRANSFER") counts.transfer += 1;
    else counts.adjustment += 1;
    if (first === null || movement.date < first) first = movement.date;
    if (last === null || movement.date > last) last = movement.date;
    applyToBalances(balances, movement);
  }

  const accounts: AccountProposal[] = [];
  for (const account of snapshot.accounts) {
    const balance = Money.ofMinor(balances.get(account.sourceId) ?? 0n, account.currency);
    if (isErr(balance)) return balance;
    accounts.push({
      sourceId: account.sourceId,
      name: account.name,
      mapping: { kind: "new", type: account.type, currency: account.currency },
      cutOffDay: account.cutOffDay,
      paymentDay: account.paymentDay,
      sourceClosingBalance: balance.value,
    });
  }

  const categories: CategoryProposal[] = snapshot.categories.map((category) => ({
    sourceId: category.sourceId,
    name: category.name,
    icon: category.icon,
    kind: category.kind,
    parentSourceId: category.parentSourceId,
    proposal: category.parentSourceId
      ? { kind: "subcategory", parentSourceId: category.parentSourceId }
      : matchCatalog(category.name, category.kind),
    archived: category.deleted,
  }));

  const existing = new Set(
    (options.existing ?? []).map((m) => fingerprint(m.accountSourceId, m.date, m.amountMinor, m.kind)),
  );
  const duplicates = snapshot.movements
    .filter((m) => existing.has(fingerprint(m.accountSourceId, m.date, m.amount.minor, m.kind)))
    .map((m) => ({ sourceKey: m.sourceKey }));

  return ok({
    sourceApp: snapshot.sourceApp,
    counts: {
      ...counts,
      total: snapshot.movements.length,
      skippedZero: snapshot.skipped.zeroAmountMovements,
    },
    dateRange: first && last ? { first, last } : null,
    accounts,
    categories,
    duplicates,
    leftOut: { budgets: snapshot.budgets.length, zeroAmountMovements: snapshot.skipped.zeroAmountMovements },
    warnings: snapshot.warnings,
  });
};
