import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";

export type TransactionId = Id<"Transaction">;
export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT";
export type SplitMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES" | "BY_ALLOCATION";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2: memberId is null only for SHARED_FUND payments; accountId only for guest payers (M2). */
export interface Payment {
  readonly memberId: string | null;
  readonly accountId: string | null;
  readonly amount: bigint;
}

export interface Share {
  readonly memberId: string;
  readonly amount: bigint;
  readonly splitMethod: SplitMethod;
}

interface TransactionBase {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description: string;
  /** The local calendar date it counts in; its period is derived on read (HU-E4-04, HU-E4-14). */
  readonly date: LocalDate;
  /** HU-E4-14, D19: when it happened (UTC); null for a transaction without a time. */
  readonly occurredAt: Date | null;
  /** HU-E4-14: the recorder's IANA zone; set exactly when `occurredAt` is. */
  readonly timeZone: string | null;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /** Optimistic-concurrency version, exposed as the ETag. */
  readonly version: number;
}

export interface Expense extends TransactionBase {
  readonly type: "EXPENSE";
  readonly categoryId: string;
  readonly payments: readonly Payment[];
  readonly shares: readonly Share[];
}

export interface Income extends TransactionBase {
  readonly type: "INCOME";
  readonly categoryId: string;
  readonly destinationAccountId: string;
  readonly receivingMemberId: string;
}

/**
 * HU-E4-03: money between the requester's own accounts (`payerMemberId` null). HU-E4-09: a fund
 * contribution into a SHARED_FUND account by `payerMemberId`, from their own account or, for a
 * guest, from outside the app (`sourceAccountId` null, spec 5.2).
 */
export interface Transfer extends TransactionBase {
  readonly type: "TRANSFER";
  readonly categoryId: null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string;
  readonly payerMemberId: string | null;
}

/**
 * HU-E5-02: `payerMemberId` pays `receivingMemberId` to clear a balance. Both accounts are
 * optional and, when set, belong to the respective party; guests never have one.
 */
export interface Settlement extends TransactionBase {
  readonly type: "SETTLEMENT";
  readonly categoryId: null;
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
}

export type Transaction = Expense | Income | Transfer | Settlement;

export interface TransactionChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  /** HU-E4-14: the resulting time; null keeps a row without one untimed and never clears a stored one (P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string | null;
  readonly categoryId?: string;
  readonly amount?: bigint;
  /** Ruling P186: an expense's new payments and shares, replaced whole; they must still add up to the amount. */
  readonly payments?: readonly Payment[];
  readonly shares?: readonly Share[];
  /** Ruling P186: an income's receiving account, or an own transfer's accounts. */
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
}

/**
 * Audited changes; values are strings so bigints survive JSON. An expense's `payments` and `shares`
 * are JSON arrays in position order, and a deletion lists every value it retires with `to: null` (D8).
 */
export type ChangeSet = Readonly<
  Record<string, { readonly from: string | null; readonly to: string | null }>
>;

const MAX_DESCRIPTION = 200;

export const positiveAmount = (amount: bigint): Result<bigint> =>
  amount > 0n ? ok(amount) : err(domainError("InvalidAmount", { amount: amount.toString() }));

const descriptionOf = (raw: string | undefined): Result<string> => {
  const text = (raw ?? "").trim();
  return text.length <= MAX_DESCRIPTION
    ? ok(text)
    : err(domainError("InvalidDescription", { length: text.length }));
};

const sum = (amounts: readonly bigint[]): bigint => amounts.reduce((a, b) => a + b, 0n);

/** Spec 5.2 shared invariant: Σ payments = Σ shares = amount, every part positive. */
const checkParts = (amount: bigint, payments: readonly Payment[], shares: readonly Share[]): Result<void> => {
  if (shares.length === 0) return err(domainError("ParticipantsRequired"));
  if (payments.length === 0) return err(domainError("PaymentsRequired"));
  // D5: a fund-paid expense has one payment, from the fund: it never mixes with member payments or other fund payments.
  if (payments.length > 1 && payments.some((p) => p.memberId === null)) {
    return err(domainError("MixedFundPayment"));
  }
  if ([...payments, ...shares].some((part) => part.amount <= 0n)) return err(domainError("InvalidAmount"));
  if (sum(payments.map((p) => p.amount)) !== amount || sum(shares.map((s) => s.amount)) !== amount) {
    return err(domainError("SharesDoNotMatchAmount"));
  }
  return ok(undefined);
};

interface NewTransaction {
  readonly id: TransactionId;
  readonly spaceId: string;
  readonly description?: string;
  readonly date: LocalDate;
  readonly amount: bigint;
  readonly currency: string;
  readonly createdBy: string;
  readonly now: Date;
  /** HU-E4-14: both absent for a transaction without a time. */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string | null;
}

const baseOf = (input: NewTransaction): Result<TransactionBase> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const occurredAt = input.occurredAt ?? null;
  const timeZone = input.timeZone ?? null;
  // HU-E4-14: an instant and its zone come together (transactions_time_zone); never reachable over HTTP.
  if ((occurredAt === null) !== (timeZone === null)) return err(domainError("InvalidTransactionTime"));
  const description = descriptionOf(input.description);
  if (!description.ok) return description;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    date: input.date,
    occurredAt,
    timeZone,
    amount: amount.value,
    currency: input.currency,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    version: 1,
  });
};

export const recordExpense = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly payments: readonly Payment[];
    readonly shares: readonly Share[];
  },
): Result<Expense> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  const parts = checkParts(base.value.amount, input.payments, input.shares);
  if (!parts.ok) return parts;
  return ok({
    ...base.value,
    type: "EXPENSE" as const,
    categoryId: input.categoryId,
    payments: input.payments,
    shares: input.shares,
  });
};

export const recordIncome = (
  input: NewTransaction & {
    readonly categoryId: string;
    readonly destinationAccountId: string;
    readonly receivingMemberId: string;
  },
): Result<Income> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  return ok({
    ...base.value,
    type: "INCOME" as const,
    categoryId: input.categoryId,
    destinationAccountId: input.destinationAccountId,
    receivingMemberId: input.receivingMemberId,
  });
};

export const recordTransfer = (
  input: NewTransaction & { readonly sourceAccountId: string; readonly destinationAccountId: string },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    payerMemberId: null,
  });
};

/** HU-E4-09: a TRANSFER into the shared fund by a member; it belongs to the fund's space (D9). */
export const recordFundContribution = (
  input: NewTransaction & {
    readonly payerMemberId: string;
    readonly sourceAccountId: string | null;
    readonly destinationAccountId: string;
  },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    payerMemberId: input.payerMemberId,
  });
};

/** HU-E5-02: a settlement between two different members of the space. */
export const recordSettlement = (
  input: NewTransaction & {
    readonly payerMemberId: string;
    readonly receivingMemberId: string;
    readonly sourceAccountId: string | null;
    readonly destinationAccountId: string | null;
  },
): Result<Settlement> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.payerMemberId === input.receivingMemberId) return err(domainError("InvalidSettlementParties"));
  return ok({
    ...base.value,
    type: "SETTLEMENT" as const,
    categoryId: null,
    payerMemberId: input.payerMemberId,
    receivingMemberId: input.receivingMemberId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
  });
};

/**
 * HU-E4-06: a sole payment or share follows a new amount; otherwise the parts must still add up. Ruling P186: new
 * `payments`, `shares` or accounts replace the current ones.
 */
export const reviseTransaction = (
  tx: Transaction,
  changes: TransactionChanges,
  now: Date,
): Result<Transaction> => {
  const description =
    changes.description === undefined ? ok(tx.description) : descriptionOf(changes.description);
  if (!description.ok) return description;
  const amount = changes.amount === undefined ? ok(tx.amount) : positiveAmount(changes.amount);
  if (!amount.ok) return amount;
  // HU-E4-14, ruling P66: a recorded time is replaced, never removed, neither its instant nor its zone
  // (retimed refuses the request first).
  if (tx.occurredAt !== null && (changes.occurredAt === null || changes.timeZone === null)) {
    return err(domainError("TimeRequired"));
  }
  const common = {
    description: description.value,
    date: changes.date ?? tx.date,
    occurredAt: changes.occurredAt === undefined ? tx.occurredAt : changes.occurredAt,
    timeZone: changes.timeZone === undefined ? tx.timeZone : changes.timeZone,
    amount: amount.value,
    updatedAt: now,
  };
  // HU-E4-14: the pair stays whole, as when recording (transactions_time_zone); never reachable over HTTP.
  if ((common.occurredAt === null) !== (common.timeZone === null)) {
    return err(domainError("InvalidTransactionTime"));
  }
  switch (tx.type) {
    case "EXPENSE": {
      const payments =
        changes.payments ??
        (tx.payments.length === 1 ? [{ ...tx.payments[0]!, amount: amount.value }] : tx.payments);
      const shares =
        changes.shares ?? (tx.shares.length === 1 ? [{ ...tx.shares[0]!, amount: amount.value }] : tx.shares);
      const parts = checkParts(amount.value, payments, shares);
      if (!parts.ok) return parts;
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId, payments, shares });
    }
    case "INCOME":
      return ok({
        ...tx,
        ...common,
        categoryId: changes.categoryId ?? tx.categoryId,
        destinationAccountId: changes.destinationAccountId ?? tx.destinationAccountId,
      });
    case "TRANSFER": {
      if (changes.categoryId !== undefined) return err(domainError("TransferHasNoCategory"));
      const source = changes.sourceAccountId ?? tx.sourceAccountId;
      const destination = changes.destinationAccountId ?? tx.destinationAccountId;
      if (source === destination) return err(domainError("SameAccountTransfer"));
      return ok({ ...tx, ...common, sourceAccountId: source, destinationAccountId: destination });
    }
    case "SETTLEMENT":
      return changes.categoryId === undefined
        ? ok({ ...tx, ...common })
        : err(domainError("SettlementHasNoCategory"));
  }
};

/** What each account a transaction debits loses: expense payments and TRANSFER/SETTLEMENT sources. */
const debitsOf = (tx: Transaction): ReadonlyMap<string, bigint> => {
  switch (tx.type) {
    case "EXPENSE":
      return new Map(
        tx.payments.flatMap((p) => (p.accountId === null ? [] : [[p.accountId, p.amount] as const])),
      );
    case "INCOME":
      return new Map();
    case "TRANSFER":
    case "SETTLEMENT":
      return new Map(tx.sourceAccountId === null ? [] : [[tx.sourceAccountId, tx.amount] as const]);
  }
};

/** D9: the accounts `before` debits whose debited amount differs in `after`; credited accounts never count. */
export const changedDebits = (before: Transaction, after: Transaction): string[] => {
  const revised = debitsOf(after);
  return [...debitsOf(before)].filter(([id, amount]) => revised.get(id) !== amount).map(([id]) => id);
};

/**
 * E5 balance rule: the members whose net a transaction moves — the payers and participants of a
 * member-paid expense and both parties of a settlement; nobody for fund-paid expenses, transfers
 * (fund contributions included) and incomes (D5).
 */
export const balanceParties = (tx: Transaction): string[] => {
  if (tx.type === "SETTLEMENT") return [tx.payerMemberId, tx.receivingMemberId];
  if (tx.type !== "EXPENSE" || tx.payments.some((p) => p.memberId === null)) return [];
  const payers = tx.payments.flatMap((p) => (p.memberId === null ? [] : [p.memberId]));
  return [...new Set([...payers, ...tx.shares.map((s) => s.memberId)])];
};

/** D8: transactions are never hard-deleted. */
export const softDelete = (tx: Transaction, now: Date): Transaction => ({
  ...tx,
  deletedAt: now,
  updatedAt: now,
});

/** Ruling P185: undoing a deletion; the row comes back as it was deleted (D8). */
export const restore = (tx: Transaction, now: Date): Transaction => ({
  ...tx,
  deletedAt: null,
  updatedAt: now,
});

const AUDITED = ["description", "date", "categoryId", "amount"] as const;

/**
 * D8 (Task 0b): every audited value as a string — the fields and, for an expense, its payments and
 * shares as deterministic JSON in position order (amounts in minor units). Saving an edit replaces
 * their rows, so the audit is where every earlier split lives.
 */
const auditedValues = (tx: Transaction): ReadonlyMap<string, string | null> => {
  const values = new Map<string, string | null>(
    AUDITED.map((field): [string, string | null] => [field, tx[field] === null ? null : String(tx[field])]),
  );
  // HU-E4-14: the instant as ISO UTC and its zone, so an edit records the time before and after.
  values.set("occurredAt", tx.occurredAt?.toISOString() ?? null);
  values.set("timeZone", tx.timeZone);
  if (tx.type === "EXPENSE") {
    const payments = tx.payments.map((p) => ({
      memberId: p.memberId,
      accountId: p.accountId,
      amount: p.amount.toString(),
    }));
    const shares = tx.shares.map((s) => ({
      memberId: s.memberId,
      amount: s.amount.toString(),
      splitMethod: s.splitMethod,
    }));
    values.set("payments", JSON.stringify(payments));
    values.set("shares", JSON.stringify(shares));
  }
  // Ruling P187: an income's, a transfer's and a settlement's accounts, so an edit of them is traceable.
  if (tx.type !== "EXPENSE") {
    values.set("sourceAccountId", tx.type === "INCOME" ? null : tx.sourceAccountId);
    values.set("destinationAccountId", tx.destinationAccountId);
  }
  return values;
};

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const revised = auditedValues(after);
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const [key, from] of auditedValues(before)) {
    const to = revised.get(key) ?? null;
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
};

/** D8 (Task 0b): a deletion keeps the whole last version in the audit, every value with `to: null`. */
export const deletionChanges = (tx: Transaction): ChangeSet => {
  const changes: Record<string, { from: string; to: null }> = {};
  for (const [key, from] of auditedValues(tx)) if (from !== null) changes[key] = { from, to: null };
  return changes;
};

/** Ruling P185: a restore brings every audited value back, each `from: null`, mirroring `deletionChanges`. */
export const restorationChanges = (tx: Transaction): ChangeSet => {
  const changes: Record<string, { from: null; to: string }> = {};
  for (const [key, to] of auditedValues(tx)) if (to !== null) changes[key] = { from: null, to };
  return changes;
};

/** HU-E4-06: owners and admins change any transaction, members only their own, viewers none. */
export const canModify = (role: MemberRole | null, createdBy: string, userId: string): boolean =>
  role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && createdBy === userId);
