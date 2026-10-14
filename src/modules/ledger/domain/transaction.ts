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
  /** Calendar date in the space timezone; its period is derived on read (HU-E4-04). */
  readonly date: LocalDate;
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
  readonly categoryId?: string;
  readonly amount?: bigint;
}

/** Audited field changes; values are strings so bigints survive JSON. */
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
}

const baseOf = (input: NewTransaction): Result<TransactionBase> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const description = descriptionOf(input.description);
  if (!description.ok) return description;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    date: input.date,
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

/** HU-E4-06: a sole payment or share follows a new amount; otherwise the parts must still add up. */
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
  const common = {
    description: description.value,
    date: changes.date ?? tx.date,
    amount: amount.value,
    updatedAt: now,
  };
  switch (tx.type) {
    case "EXPENSE": {
      const payments =
        tx.payments.length === 1 ? [{ ...tx.payments[0]!, amount: amount.value }] : tx.payments;
      const shares = tx.shares.length === 1 ? [{ ...tx.shares[0]!, amount: amount.value }] : tx.shares;
      const parts = checkParts(amount.value, payments, shares);
      if (!parts.ok) return parts;
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId, payments, shares });
    }
    case "INCOME":
      return ok({ ...tx, ...common, categoryId: changes.categoryId ?? tx.categoryId });
    case "TRANSFER":
      return changes.categoryId === undefined
        ? ok({ ...tx, ...common })
        : err(domainError("TransferHasNoCategory"));
    case "SETTLEMENT":
      return changes.categoryId === undefined
        ? ok({ ...tx, ...common })
        : err(domainError("SettlementHasNoCategory"));
  }
};

/** D8: transactions are never hard-deleted. */
export const softDelete = (tx: Transaction, now: Date): Transaction => ({
  ...tx,
  deletedAt: now,
  updatedAt: now,
});

const AUDITED = ["description", "date", "categoryId", "amount"] as const;

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of AUDITED) {
    const from = before[field] === null ? null : String(before[field]);
    const to = after[field] === null ? null : String(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
};

/** HU-E4-06: owners and admins change any transaction, members only their own, viewers none. */
export const canModify = (role: MemberRole | null, createdBy: string, userId: string): boolean =>
  role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && createdBy === userId);
