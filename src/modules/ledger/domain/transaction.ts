import { domainError, err, map, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";

export type TransactionId = Id<"Transaction">;
export type TransactionType = "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT" | "ADJUSTMENT";
export type SplitMethod = "EQUAL" | "PERCENT" | "EXACT" | "SHARES" | "BY_ALLOCATION";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2: memberId is null only for SHARED_FUND payments; accountId only for guest payers (M2). */
export interface Payment {
  readonly memberId: string | null;
  readonly accountId: string | null;
  readonly amount: bigint;
  /** D29, slice MC3: the amount in the paying account's own currency, when it differs from the base amount. */
  readonly accountAmount?: bigint;
  /** D29, slice MC3: the paying account's own currency; set exactly when `accountAmount` is. */
  readonly accountCurrency?: string;
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
  /** D29, slice MC3: what was charged when it differs from the base amount; its currency is `originalCurrency`. */
  readonly originalAmount?: bigint;
  readonly originalCurrency?: string;
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
  /** D26: the contribution to the fund that paid for this fund-paid expense; absent on every other expense. */
  readonly linkedTransactionId?: TransactionId;
}

export interface Income extends TransactionBase {
  readonly type: "INCOME";
  readonly categoryId: string;
  readonly destinationAccountId: string;
  readonly receivingMemberId: string;
  /** D29, slice MC3: the amount in the destination account's own currency, when it differs from the base amount. */
  readonly destinationAmount?: bigint;
  /** D29, slice MC3: the destination account's own currency; set exactly when `destinationAmount` is. */
  readonly destinationCurrency?: string;
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
  /** D26: the fund-paid expense this contribution paid for; absent on every other transfer. */
  readonly linkedTransactionId?: TransactionId;
  /** D29, slice MC3: "Sale" and "Llega" in each account's own currency, when either differs from the base amount. */
  readonly sourceAmount?: bigint;
  readonly destinationAmount?: bigint;
  /** D29, slice MC3: the currency each present leg is in (its account's own); set exactly when its leg amount is. */
  readonly sourceCurrency?: string;
  readonly destinationCurrency?: string;
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
  /** Ruling P322: PAYMENT moved money, GIFT gave away a payment made for someone, FORGIVENESS forgave a debt. */
  readonly reason: SettlementReason;
  /** Ruling P322: the member whose debt this payment paid; neither the payer nor the receiver. */
  readonly onBehalfOfMemberId: string | null;
  /** Ruling P322: the other half of a gift; the payment and its GIFT point at each other. */
  readonly linkedTransactionId: TransactionId | null;
  /** D29, slice MC3: each account's leg in its own currency, when that account's currency is not the base. */
  readonly sourceAmount?: bigint;
  readonly sourceCurrency?: string;
  readonly destinationAmount?: bigint;
  readonly destinationCurrency?: string;
}

/** Ruling P322: why a settlement was recorded. */
export type SettlementReason = "PAYMENT" | "GIFT" | "FORGIVENESS";

/**
 * Design Q4, gap G1 (#329): a balance adjustment ("Ajuste de saldo") moves one account's balance and nothing else: it is
 * never spending or income, has no category, payer, payments or shares. Money in names the account as its destination,
 * money out as its source; exactly one of the two is set and `amount` is positive, like every other movement's.
 */
export interface Adjustment extends TransactionBase {
  readonly type: "ADJUSTMENT";
  readonly categoryId: null;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  /** D29, slice MC3: the account's leg in its own currency, when that currency is not the base; on its one side. */
  readonly sourceAmount?: bigint;
  readonly sourceCurrency?: string;
  readonly destinationAmount?: bigint;
  readonly destinationCurrency?: string;
}

export type Transaction = Expense | Income | Transfer | Settlement | Adjustment;

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
  /**
   * Ruling P186: an income's receiving account, or an own transfer's accounts. P344: also a settlement's and a fund
   * contribution's, where null leaves a side with no account (a settlement's either side, a contribution's source).
   */
  readonly sourceAccountId?: string | null;
  readonly destinationAccountId?: string | null;
  /** P344 (S4): a settlement's or a fund contribution's payer, another member of the space. */
  readonly payerMemberId?: string;
  /** P344 (S4): a settlement's receiver, another member of the space. */
  readonly receivingMemberId?: string;
  /**
   * D29, slice MC3: the original a new amount was entered in, or null when it was entered in the base currency (the
   * original goes); absent keeps the current one.
   */
  readonly original?: { readonly amount: bigint; readonly currency: string } | null;
  /**
   * D29, slice MC3: every account leg again, as recording computes them. Absent keeps them, unless the amount, the
   * payments or an account change: then a leg no longer holds, so none is kept.
   */
  readonly legs?: TransactionLegs;
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
  // D29, slice MC3: a present account leg is money in the account's own currency, so it is positive like the base.
  if (payments.some((p) => p.accountAmount !== undefined && p.accountAmount <= 0n)) {
    return err(domainError("InvalidAmount"));
  }
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

/**
 * D29, slice MC3: the original amount and its currency come together and are positive, or neither is present (the
 * movement is wholly in the base currency). P342: a new movement is stored in its own currency and keeps no original;
 * only an edit of a movement recorded before it still sets or clears one (`withOriginal`).
 */
const originalOf = (
  amount: bigint | undefined,
  currency: string | undefined,
): Result<{ originalAmount?: bigint; originalCurrency?: string }> => {
  if (amount === undefined && currency === undefined) return ok({});
  if (amount === undefined || currency === undefined) return err(domainError("InvalidOriginalAmount"));
  const positive = positiveAmount(amount);
  if (!positive.ok) return positive;
  return ok({ originalAmount: amount, originalCurrency: currency });
};

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
    /** D29, P342: the destination account's leg in its own currency, when that is not the income's. */
    readonly destination?: AccountLeg | null;
  },
): Result<Income> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  const income: Income = {
    ...base.value,
    type: "INCOME" as const,
    categoryId: input.categoryId,
    destinationAccountId: input.destinationAccountId,
    receivingMemberId: input.receivingMemberId,
  };
  return withLegs(income, { destination: input.destination ?? null }) as Result<Income>;
};

/**
 * D29, slice MC3: a transfer leg ("Sale"/"Llega") is an amount in its account's own currency; its amount and currency
 * come together and are positive, or neither is present (the leg equals the base amount, so no leg is stored).
 */
const transferLegOf = (
  amount: bigint | undefined,
  currency: string | undefined,
): Result<{ readonly amount: bigint; readonly currency: string } | null> => {
  if (amount === undefined && currency === undefined) return ok(null);
  if (amount === undefined || currency === undefined) return err(domainError("InvalidTransferLeg"));
  const positive = positiveAmount(amount);
  if (!positive.ok) return positive;
  return ok({ amount, currency });
};

export const recordTransfer = (
  input: NewTransaction & {
    readonly sourceAccountId: string;
    readonly destinationAccountId: string;
    /** D29, slice MC3: "Sale" in the source account's own currency, when it differs from the base amount. */
    readonly sourceAmount?: bigint;
    readonly sourceCurrency?: string;
    /** D29, slice MC3: "Llega" in the destination account's own currency, when it differs from the base amount. */
    readonly destinationAmount?: bigint;
    readonly destinationCurrency?: string;
  },
): Result<Transfer> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.sourceAccountId === input.destinationAccountId) return err(domainError("SameAccountTransfer"));
  const source = transferLegOf(input.sourceAmount, input.sourceCurrency);
  if (!source.ok) return source;
  const destination = transferLegOf(input.destinationAmount, input.destinationCurrency);
  if (!destination.ok) return destination;
  return ok({
    ...base.value,
    type: "TRANSFER" as const,
    categoryId: null,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    payerMemberId: null,
    ...(source.value === null
      ? {}
      : { sourceAmount: source.value.amount, sourceCurrency: source.value.currency }),
    ...(destination.value === null
      ? {}
      : { destinationAmount: destination.value.amount, destinationCurrency: destination.value.currency }),
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

/**
 * HU-E5-02: a settlement between two different members of the space. Ruling P322: a PAYMENT may pay a third member's
 * debt (`onBehalfOfMemberId`, InvalidOnBehalfOf when it names a party) and only such a payment may be a `gift`
 * (GiftRequiresOnBehalfOf); a FORGIVENESS moves no money, so it names no account (ForgivenessHasNoAccounts).
 */
export const recordSettlement = (
  input: NewTransaction & {
    readonly payerMemberId: string;
    readonly receivingMemberId: string;
    readonly sourceAccountId: string | null;
    readonly destinationAccountId: string | null;
    readonly reason?: "PAYMENT" | "FORGIVENESS";
    readonly onBehalfOfMemberId?: string | null;
    readonly gift?: boolean;
  },
): Result<Settlement> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  if (input.payerMemberId === input.receivingMemberId) return err(domainError("InvalidSettlementParties"));
  const reason = input.reason ?? "PAYMENT";
  const onBehalfOf = input.onBehalfOfMemberId ?? null;
  if (input.gift === true && onBehalfOf === null) return err(domainError("GiftRequiresOnBehalfOf"));
  const party = onBehalfOf === input.payerMemberId || onBehalfOf === input.receivingMemberId;
  if (onBehalfOf !== null && (party || reason === "FORGIVENESS"))
    return err(domainError("InvalidOnBehalfOf"));
  if (reason === "FORGIVENESS" && (input.sourceAccountId !== null || input.destinationAccountId !== null)) {
    return err(domainError("ForgivenessHasNoAccounts"));
  }
  return ok({
    ...base.value,
    type: "SETTLEMENT" as const,
    categoryId: null,
    payerMemberId: input.payerMemberId,
    receivingMemberId: input.receivingMemberId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    reason,
    onBehalfOfMemberId: onBehalfOf,
    linkedTransactionId: null,
  });
};

/**
 * Design Q4 (#329): a balance adjustment of one account, money in (`direction` IN, the account is the destination) or
 * out (OUT, its source). Its leg in the account's own currency is `withLegs`' to add, as for every other movement.
 */
export const recordAdjustment = (
  input: NewTransaction & { readonly accountId: string; readonly direction: "IN" | "OUT" },
): Result<Adjustment> => {
  const base = baseOf(input);
  if (!base.ok) return base;
  return ok({
    ...base.value,
    type: "ADJUSTMENT" as const,
    categoryId: null,
    sourceAccountId: input.direction === "OUT" ? input.accountId : null,
    destinationAccountId: input.direction === "IN" ? input.accountId : null,
  });
};

/** Design Q4: the one account an adjustment moves, and whether money came in (positive) or went out. */
export const adjustedAccountOf = (tx: Adjustment): { readonly accountId: string; readonly sign: 1n | -1n } =>
  tx.destinationAccountId === null
    ? { accountId: tx.sourceAccountId!, sign: -1n }
    : { accountId: tx.destinationAccountId, sign: 1n };

/**
 * Ruling P322 "Se lo regalo": the payer gives away what the member they paid for now owes them. The GIFT is a
 * settlement from that member to the payer with no accounts, at the same moment, for the same amount and by the same
 * recorder, and both halves point at each other.
 */
export const giveAway = (payment: Settlement, giftId: TransactionId): Result<[Settlement, Settlement]> => {
  if (payment.reason !== "PAYMENT" || payment.onBehalfOfMemberId === null) {
    return err(domainError("GiftRequiresOnBehalfOf"));
  }
  const gift: Settlement = {
    // D29: the gift moves no account, so it carries none of the payment's account legs.
    ...without(payment, LEG_FIELDS),
    id: giftId,
    payerMemberId: payment.onBehalfOfMemberId,
    receivingMemberId: payment.payerMemberId,
    sourceAccountId: null,
    destinationAccountId: null,
    reason: "GIFT",
    onBehalfOfMemberId: null,
    linkedTransactionId: payment.id,
  };
  return ok([{ ...payment, linkedTransactionId: giftId }, gift]);
};

/** Ruling P322, D26: the other half of a linked pair (a gift, or an expense paid for the fund), or null. */
export const linkedHalfOf = (tx: Transaction): TransactionId | null =>
  tx.type === "INCOME" || tx.type === "ADJUSTMENT" ? null : (tx.linkedTransactionId ?? null);

/**
 * D26: an expense paid for the fund. A member's contribution to the fund and the fund's payment of the expense, for the
 * same amount and at the same moment, recorded together and pointing at each other: the fund's balance does not move,
 * the payment counts as the member's contribution, and nobody owes anybody (D5).
 */
export const payForFund = (contribution: Transfer, expense: Expense): Result<[Transfer, Expense]> => {
  const [payment, ...others] = expense.payments;
  const fundPays =
    others.length === 0 &&
    payment?.memberId === null &&
    payment.accountId === contribution.destinationAccountId;
  const together =
    contribution.amount === expense.amount &&
    contribution.date === expense.date &&
    contribution.occurredAt?.getTime() === expense.occurredAt?.getTime();
  if (contribution.payerMemberId === null || !fundPays || !together) {
    return err(domainError("InvalidPaidForFund", { reason: "notAPair" }));
  }
  return ok([
    { ...contribution, linkedTransactionId: expense.id },
    { ...expense, linkedTransactionId: contribution.id },
  ]);
};

/**
 * Ruling P322 "Perdonar": only the receiver's own user forgives what the receiver is owed; a guest receiver has no
 * user, so an OWNER or ADMIN forgives for them.
 */
export const mayForgive = (
  receiver: { readonly userId: string | null },
  recorder: { readonly userId: string; readonly role: MemberRole | null },
): boolean =>
  receiver.userId === null
    ? recorder.role === "OWNER" || recorder.role === "ADMIN"
    : receiver.userId === recorder.userId;

/** D29 section 4.1, P342: an account's leg, the movement in that account's own currency when it is not the movement's. */
export interface AccountLeg {
  readonly amount: bigint;
  readonly currency: string;
}

/**
 * D29 section 4.1, P342: the legs of a transaction's accounts, null for an account in the movement's own currency (it
 * moves by the amount) or no account: an expense's in payment order, the others' source and destination.
 */
export interface TransactionLegs {
  readonly payments?: readonly (AccountLeg | null)[];
  readonly source?: AccountLeg | null;
  readonly destination?: AccountLeg | null;
}

const LEG_FIELDS = [
  "sourceAmount",
  "sourceCurrency",
  "destinationAmount",
  "destinationCurrency",
  "accountAmount",
  "accountCurrency",
] as const;

/** `value` without the given fields, so an absent leg or original reads as absent, never as undefined. */
const without = <T extends object>(value: T, fields: readonly string[]): T =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))) as T;

const legOf = (leg: AccountLeg | null | undefined): Result<AccountLeg | null> =>
  leg === null || leg === undefined ? ok(null) : map(positiveAmount(leg.amount), () => leg);

/**
 * D29, section 4.1: replaces every account leg of `tx` with `legs`, each positive and only on an account that exists;
 * a missing leg means the account is in the base currency, so its leg is the base amount and nothing is stored.
 */
export const withLegs = (tx: Transaction, legs: TransactionLegs): Result<Transaction> => {
  const bare = without(tx, LEG_FIELDS);
  if (tx.type === "EXPENSE") {
    const given = legs.payments ?? [];
    if (given.length > tx.payments.length) return err(domainError("InvalidTransferLeg"));
    const payments: Payment[] = [];
    for (const [index, payment] of tx.payments.entries()) {
      const leg = legOf(given[index]);
      if (!leg.ok) return leg;
      if (leg.value !== null && payment.accountId === null) return err(domainError("InvalidTransferLeg"));
      const plain = without(payment, LEG_FIELDS);
      payments.push(
        leg.value === null
          ? plain
          : { ...plain, accountAmount: leg.value.amount, accountCurrency: leg.value.currency },
      );
    }
    return ok({ ...(bare as Expense), payments });
  }
  const source = legOf(legs.source);
  if (!source.ok) return source;
  const destination = legOf(legs.destination);
  if (!destination.ok) return destination;
  const sourceAccountId = tx.type === "INCOME" ? null : tx.sourceAccountId;
  if (
    (source.value !== null && (tx.type === "INCOME" || sourceAccountId === null)) ||
    (destination.value !== null && tx.destinationAccountId === null)
  ) {
    return err(domainError("InvalidTransferLeg"));
  }
  return ok({
    ...bare,
    ...(source.value === null
      ? {}
      : { sourceAmount: source.value.amount, sourceCurrency: source.value.currency }),
    ...(destination.value === null
      ? {}
      : { destinationAmount: destination.value.amount, destinationCurrency: destination.value.currency }),
  } as Transaction);
};

/** D29, slice MC3: `tx` with `original` as its original amount, or with none when it is null. */
const withOriginal = (
  tx: Transaction,
  original: { readonly amount: bigint; readonly currency: string } | null,
): Result<Transaction> => {
  const bare = without(tx, ["originalAmount", "originalCurrency"]);
  if (original === null) return ok(bare);
  return map(originalOf(original.amount, original.currency), (kept) => ({ ...bare, ...kept }) as Transaction);
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
  const revised = revisedParts(tx, changes, now);
  if (!revised.ok) return revised;
  const moved =
    (changes.amount !== undefined && changes.amount !== tx.amount) ||
    changes.payments !== undefined ||
    changes.sourceAccountId !== undefined ||
    changes.destinationAccountId !== undefined;
  const legs = changes.legs ?? (moved ? {} : undefined);
  const legged = legs === undefined ? revised : withLegs(revised.value, legs);
  if (!legged.ok || changes.original === undefined) return legged;
  // D29, slice MC3: a new amount brings its original (or none, entered in the base currency), as when recording.
  return withOriginal(legged.value, changes.original);
};

const revisedParts = (tx: Transaction, changes: TransactionChanges, now: Date): Result<Transaction> => {
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
  // P344 (S4): only a settlement's members and a fund contribution's payer change; every other type keeps its own.
  const contribution = tx.type === "TRANSFER" && tx.payerMemberId !== null;
  if (changes.payerMemberId !== undefined && tx.type !== "SETTLEMENT" && !contribution) {
    return err(domainError("FieldNotEditable", { field: "payerMemberId" }));
  }
  if (changes.receivingMemberId !== undefined && tx.type !== "SETTLEMENT") {
    return err(domainError("FieldNotEditable", { field: "receivingMemberId" }));
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
      const source = changes.sourceAccountId === undefined ? tx.sourceAccountId : changes.sourceAccountId;
      const destination = changes.destinationAccountId ?? tx.destinationAccountId;
      // Spec 5.2: a transfer always reaches an account, and only a fund contribution may come from none (P344: one
      // whose payer has no account named).
      if (changes.destinationAccountId === null || (source === null && !contribution)) {
        return err(domainError("AccountRequired"));
      }
      if (source === destination) return err(domainError("SameAccountTransfer"));
      return ok({
        ...tx,
        ...common,
        payerMemberId: changes.payerMemberId ?? tx.payerMemberId,
        sourceAccountId: source,
        destinationAccountId: destination,
      });
    }
    case "SETTLEMENT":
      if (changes.categoryId !== undefined) return err(domainError("SettlementHasNoCategory"));
      return revisedSettlement({ ...tx, ...common }, changes);
    // Design Q4: an adjustment keeps its one account and its direction; a category never fits it.
    case "ADJUSTMENT":
      if (changes.categoryId !== undefined) return err(domainError("AdjustmentHasNoCategory"));
      if (changes.sourceAccountId !== undefined || changes.destinationAccountId !== undefined) {
        return err(domainError("FieldNotEditable", { field: "accountId" }));
      }
      return ok({ ...tx, ...common });
  }
};

/**
 * P344 (S4), HU-E5-02, ruling P322: a settlement with its edited members and accounts, under the rules of recording one:
 * two different members (InvalidSettlementParties), neither of them the member it pays for (InvalidOnBehalfOf), and no
 * account on a forgiveness or a gift, which move no money (ForgivenessHasNoAccounts).
 */
const revisedSettlement = (tx: Settlement, changes: TransactionChanges): Result<Settlement> => {
  const revised: Settlement = {
    ...tx,
    payerMemberId: changes.payerMemberId ?? tx.payerMemberId,
    receivingMemberId: changes.receivingMemberId ?? tx.receivingMemberId,
    sourceAccountId: changes.sourceAccountId === undefined ? tx.sourceAccountId : changes.sourceAccountId,
    destinationAccountId:
      changes.destinationAccountId === undefined ? tx.destinationAccountId : changes.destinationAccountId,
  };
  if (revised.payerMemberId === revised.receivingMemberId)
    return err(domainError("InvalidSettlementParties"));
  const onBehalfOf = revised.onBehalfOfMemberId;
  if (
    onBehalfOf !== null &&
    (onBehalfOf === revised.payerMemberId || onBehalfOf === revised.receivingMemberId)
  ) {
    return err(domainError("InvalidOnBehalfOf"));
  }
  if (
    revised.reason !== "PAYMENT" &&
    (revised.sourceAccountId !== null || revised.destinationAccountId !== null)
  ) {
    return err(domainError("ForgivenessHasNoAccounts"));
  }
  return ok(revised);
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
    case "ADJUSTMENT":
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
 * D8: every audited value as a string — the fields and, for an expense, its payments and
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
  // D29, slice MC3: what was entered and what each account moved in its own currency ("minor CODE"), so an edit of
  // them is kept too; absent (null) for a movement wholly in the base currency, which keeps its audit as it was.
  values.set("originalAmount", inCurrency(tx.originalAmount, tx.originalCurrency));
  if (tx.type === "EXPENSE") {
    const payments = tx.payments.map((p) => ({
      memberId: p.memberId,
      accountId: p.accountId,
      amount: p.amount.toString(),
      ...(p.accountAmount === undefined
        ? {}
        : { accountAmount: inCurrency(p.accountAmount, p.accountCurrency) }),
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
    values.set("sourceAmount", tx.type === "INCOME" ? null : inCurrency(tx.sourceAmount, tx.sourceCurrency));
    values.set("destinationAmount", inCurrency(tx.destinationAmount, tx.destinationCurrency));
  }
  return values;
};

const inCurrency = (minor: bigint | undefined, currency: string | undefined): string | null =>
  minor === undefined ? null : `${minor} ${currency ?? ""}`.trim();

/**
 * P344 (S4): a settlement's members and a fund contribution's payer, which only an edit changes; a deletion and a
 * restore keep their audited values as before, so only `changesBetween` compares these.
 */
const partiesOf = (tx: Transaction): ReadonlyMap<string, string | null> => {
  if (tx.type === "SETTLEMENT") {
    return new Map([
      ["payerMemberId", tx.payerMemberId],
      ["receivingMemberId", tx.receivingMemberId],
    ]);
  }
  return new Map(
    tx.type === "TRANSFER" && tx.payerMemberId !== null ? [["payerMemberId", tx.payerMemberId]] : [],
  );
};

export const changesBetween = (before: Transaction, after: Transaction): ChangeSet => {
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  for (const valuesOf of [partiesOf, auditedValues]) {
    const revised = valuesOf(after);
    for (const [key, from] of valuesOf(before)) {
      const to = revised.get(key) ?? null;
      if (from !== to) changes[key] = { from, to };
    }
  }
  return changes;
};

/** D8: a deletion keeps the whole last version in the audit, every value with `to: null`. */
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

/**
 * HU-E4-06: owners and admins change any recurrence, members only their own, viewers none (the matrix's money.editAny).
 * P344: movements no longer follow it; `canCorrect` decides who edits, deletes, restores or converts one.
 */
export const canModify = (role: MemberRole | null, createdBy: string, userId: string): boolean =>
  role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && createdBy === userId);

/**
 * P344 (S1, amends HU-E4-06): every member who records money (the matrix's money.record: OWNER, ADMIN, MEMBER) corrects
 * any movement of the space, whoever recorded it and whether or not they are a party to it; the audit keeps who changed
 * what (D8). A VIEWER only reads.
 */
export const canCorrect = (role: MemberRole | null): boolean =>
  role === "OWNER" || role === "ADMIN" || role === "MEMBER";
