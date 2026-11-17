import { isErr, localDateIn, Money, ok, parseTimeZone, type LocalDate, type Result } from "@/shared/kernel";
import type {
  SourceAccount,
  SourceIssue,
  SourceMovement,
  SourceMovementKind,
  SourceSnapshot,
} from "./source-snapshot";

/** A Hearth movement already present, so a matching source movement is a duplicate (design §3.1, §3.3). */
export interface ExistingMovement {
  readonly accountSourceId: string;
  readonly date: LocalDate;
  readonly amountMinor: bigint;
  readonly kind: SourceMovementKind;
  /** A transfer that reached the account (its destination side), as opposed to one that left it. */
  readonly incoming?: true;
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
  readonly duplicates: readonly { readonly sourceKey: string }[];
  readonly leftOut: { readonly budgets: number; readonly zeroAmountMovements: number };
  /** The adapter's warnings, then one `DateZoneMismatch` per movement whose date the chosen zone does not confirm. */
  readonly warnings: readonly SourceIssue[];
  /** Rows the adapter could not read; they are left out of everything above (design §3.2). */
  readonly errors: readonly SourceIssue[];
}

const fingerprint = (
  accountSourceId: string,
  date: LocalDate,
  amountMinor: bigint,
  kind: SourceMovementKind | "TRANSFER_IN",
): string => `${accountSourceId}|${date}|${amountMinor}|${kind}`;

/**
 * Design §3.1: what a source movement looks like on each account it touches. A transfer shows on both: leaving its
 * source account with its amount, and reaching its destination with what arrived, so a Hearth transfer into one of the
 * mapped accounts (its source account new or someone else's) is caught too.
 */
const fingerprintsOf = (m: SourceMovement): string[] => [
  fingerprint(m.accountSourceId, m.date, m.amount.minor, m.kind),
  ...(m.kind === "TRANSFER" && m.toAccountSourceId !== null && m.toAmount !== null
    ? [fingerprint(m.toAccountSourceId, m.date, m.toAmount.minor, "TRANSFER_IN")]
    : []),
];

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

/** Each source account's closing balance in minor units of its own currency, from every movement (design §3.1). */
export const closingBalancesOf = (movements: readonly SourceMovement[]): Map<string, bigint> => {
  const balances = new Map<string, bigint>();
  for (const movement of movements) applyToBalances(balances, movement);
  return balances;
};

/** P337: how many of the movements touch each source account, as its source or its destination. */
export const movementCountsOf = (movements: readonly SourceMovement[]): Map<string, number> => {
  const counts = new Map<string, number>();
  const see = (accountId: string | null) => {
    if (accountId !== null) counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  };
  for (const movement of movements) {
    see(movement.accountSourceId);
    if (movement.toAccountSourceId !== movement.accountSourceId) see(movement.toAccountSourceId);
  }
  return counts;
};

/**
 * Design §2.3: a movement keeps `WDATE`, but when its instant falls on another calendar day in the chosen zone the
 * preview says so, with both dates, so the person can pick another zone before confirming.
 */
const dateZoneMismatches = (movements: readonly SourceMovement[], timeZone: string): SourceIssue[] =>
  movements.flatMap((movement) => {
    if (movement.occurredAt === null) return [];
    const zoneDate = localDateIn(movement.occurredAt, timeZone);
    return zoneDate === movement.date
      ? []
      : [
          {
            code: "DateZoneMismatch",
            sourceKey: movement.sourceKey,
            details: { date: movement.date, zoneDate, timeZone },
          },
        ];
  });

/**
 * The dry run (design §3.1, §3.2): counts by kind, the date range, a proposed mapping and closing balance for each
 * account, likely duplicates, warnings, row errors, and what is left out. Pure:
 * it reads nothing and writes nothing. It never throws; it fails only on an unknown zone (`InvalidTimeZone`) or a
 * balance whose currency is unknown (`UnknownCurrency`).
 */
export const previewImport = (snapshot: SourceSnapshot, options: PreviewOptions): Result<ImportPreview> => {
  const timeZone = parseTimeZone(options.timeZone);
  if (isErr(timeZone)) return timeZone;
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

  const existing = new Set(
    (options.existing ?? []).map((m) =>
      fingerprint(m.accountSourceId, m.date, m.amountMinor, m.incoming === true ? "TRANSFER_IN" : m.kind),
    ),
  );
  const duplicates = snapshot.movements
    .filter((m) => fingerprintsOf(m).some((print) => existing.has(print)))
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
    duplicates,
    leftOut: { budgets: snapshot.budgets.length, zeroAmountMovements: snapshot.skipped.zeroAmountMovements },
    warnings: [...snapshot.warnings, ...dateZoneMismatches(snapshot.movements, timeZone.value)],
    errors: snapshot.errors,
  });
};
