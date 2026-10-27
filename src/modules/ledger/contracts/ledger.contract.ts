import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  IdSchema,
  jsonContent,
  moneyFromDto,
  MoneySchema,
  optionalLocalDate,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import { etagOf } from "@/shared/http/etag";
import { decodeCursor, encodeCursor, PaginationQuerySchema } from "@/shared/http/pagination";
import {
  domainError,
  err,
  isUuid,
  localDate,
  map,
  ok,
  type LocalDate,
  type Money,
  type Result,
} from "@/shared/kernel";
import type {
  AuditEntry,
  ConversionTarget,
  EditChanges,
  LedgerWarning,
  PaymentInput,
  RecordedExpense,
  RecordExpenseInput,
  RecordFundContributionInput,
  RecordSettlementInput,
  SplitInput,
  Transaction,
  TransactionPage,
  TransactionPosition,
} from "../application";
import { EqualSplitSchema, MAX_PARTS, PercentSplitSchema, SharesSplitSchema, splitOf } from "./split-body";
import type { DirectSplit, DirectSplitCounterpart } from "@/modules/spaces/application";

// Length rules live in the domain (InvalidDescription, 200 characters); the cap only bounds payload size.
const Description = z.string().max(1000).optional();
/** HU-E4-14: an RFC 3339 instant with any offset ("2026-10-16T14:32:00-05:00"); answers return it in UTC. */
const Instant = z.iso.datetime({ offset: true });
/** HU-E4-14: an IANA zone; whether it exists is the use case's (InvalidTimeZone). */
const TimeZoneName = z.string().min(1).max(64);

/** HU-E4-14: a body's date, instant and zone as the use cases take them; fails only for impossible dates. */
export const whenFromBody = (body: {
  readonly date?: string;
  readonly occurredAt?: string | null;
  readonly timeZone?: string;
}): Result<{ date?: LocalDate; occurredAt?: Date | null; timeZone?: string }> => {
  const date = optionalLocalDate(body.date);
  if (!date.ok) return date;
  return ok({
    date: date.value,
    // Ruling P66: an explicit null reaches the use case, which answers TimeRequired.
    occurredAt:
      body.occurredAt === undefined || body.occurredAt === null ? body.occurredAt : new Date(body.occurredAt),
    timeZone: body.timeZone,
  });
};

export const PaymentSchema = z.object({
  memberId: z.string().nullable(),
  accountId: z.string().nullable(),
  amount: MoneySchema,
});
export const ShareSchema = z.object({
  memberId: z.string(),
  amount: MoneySchema,
  splitMethod: z.enum(["EQUAL", "PERCENT", "EXACT", "SHARES", "BY_ALLOCATION"]),
});
export const TransactionSchema = z.object({
  id: z.string(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"]),
  description: z.string(),
  date: z.iso.date(),
  /** HU-E4-14: when it happened, in UTC; null only for occurrences and rows older than M3-D. */
  occurredAt: z.iso.datetime().nullable(),
  /** HU-E4-14: the IANA zone it was recorded in; null exactly when occurredAt is. */
  timeZone: z.string().nullable(),
  amount: MoneySchema,
  categoryId: z.string().nullable(),
  payments: z.array(PaymentSchema),
  shares: z.array(ShareSchema),
  sourceAccountId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  /** The receiving member of an INCOME, or the member a SETTLEMENT is paid to. */
  receivingMemberId: z.string().nullable(),
  /** The contributor of a TRANSFER into the shared fund (HU-E4-09) or the payer of a SETTLEMENT (HU-E5-02). */
  payerMemberId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Same value as the ETag; send it back in If-Match. */
  version: z.number().int(),
});

/**
 * HU-E4-07/10: one payment. `memberId` is a member of the space (registered or guest) and `accountId`
 * that member's own account, or null (or absent) for a guest, who pays outside the app; a null
 * `memberId` names the space's shared fund as payer, and `accountId` is then the fund (spec 5.2).
 */
export const PaymentBodySchema = z.object({
  memberId: IdSchema.nullable(),
  accountId: IdSchema.nullable().optional(),
  amount: MoneySchema,
});

/** HU-E4-07/08: EQUAL among the chosen members, or by percentage, exact amount or share units per member. */
export const SplitBodySchema = z.discriminatedUnion("method", [
  EqualSplitSchema,
  PercentSplitSchema,
  z.object({
    method: z.literal("EXACT"),
    participants: z.array(z.object({ memberId: IdSchema, amount: MoneySchema })).max(MAX_PARTS),
  }),
  SharesSplitSchema,
]);

/**
 * HU-E4-01 sends `accountId` (the requester pays everything from that account of theirs); HU-E4-07
 * sends `payments` instead. Without `split` the amount takes the default split (spec 5.3, HU-E6-08):
 * BY_ALLOCATION when the category resolves to an allocated line of the ACTIVE plan covering the date, else
 * EQUAL among every current member, which in a personal space is the requester alone.
 */
const RecordExpenseFields = z.object({
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  categoryId: IdSchema.optional(),
  amount: MoneySchema,
  accountId: IdSchema.optional(),
  payments: z.array(PaymentBodySchema).max(MAX_PARTS).optional(),
  split: SplitBodySchema.optional(),
});
const accountOrPayments = (body: { accountId?: string; payments?: unknown }) =>
  body.accountId === undefined || body.payments === undefined;
const accountOrPaymentsError = { error: "Send accountId or payments, not both", path: ["payments"] };
export const RecordExpenseBodySchema = RecordExpenseFields.refine(accountOrPayments, accountOrPaymentsError);
type RecordExpenseBody = z.infer<typeof RecordExpenseBodySchema>;

/** The split as the use case takes it; EXACT amounts become Money (UnknownCurrency otherwise). */
export const splitFromBody = (split: RecordExpenseBody["split"]): Result<SplitInput | undefined> => {
  if (split === undefined) return ok(undefined);
  if (split.method !== "EXACT") return ok(splitOf(split));
  const participants: { memberId: string; amount: Money }[] = [];
  for (const p of split.participants) {
    const amount = moneyFromDto(p.amount);
    if (!amount.ok) return amount;
    participants.push({ memberId: p.memberId, amount: amount.value });
  }
  return ok({ method: "EXACT" as const, participants });
};

/** A validated body as RecordExpense input; fails only for impossible dates and currencies the kernel does not know. */
export const expenseFromBody = (
  body: RecordExpenseBody,
): Result<Omit<RecordExpenseInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  let payments: PaymentInput[] | undefined;
  if (body.payments !== undefined) {
    payments = [];
    for (const payment of body.payments) {
      const paid = moneyFromDto(payment.amount);
      if (!paid.ok) return paid;
      payments.push({ memberId: payment.memberId, accountId: payment.accountId ?? null, amount: paid.value });
    }
  }
  const split = splitFromBody(body.split);
  if (!split.ok) return split;
  return ok({
    description: body.description,
    ...when.value,
    categoryId: body.categoryId,
    amount: amount.value,
    accountId: body.accountId,
    payments,
    split: split.value,
  });
};

/** `accountId` is the requester's account in this space that receives the money (HU-E4-02). */
export const RecordIncomeBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  categoryId: IdSchema.optional(),
  amount: MoneySchema,
  accountId: IdSchema,
});
export const RecordTransferBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  amount: MoneySchema,
  sourceAccountId: IdSchema,
  destinationAccountId: IdSchema,
});

/**
 * Issue #195: what an expense, income or transfer becomes, named by `type`, with the body its own record endpoint
 * takes. Every rule of recording it applies, and the original is soft-deleted in the same transaction.
 */
export const ConvertTransactionBodySchema = z.discriminatedUnion("type", [
  RecordExpenseFields.extend({ type: z.literal("EXPENSE") }).refine(
    accountOrPayments,
    accountOrPaymentsError,
  ),
  RecordIncomeBodySchema.extend({ type: z.literal("INCOME") }),
  RecordTransferBodySchema.extend({ type: z.literal("TRANSFER") }),
]);

/** A validated conversion body as the use case's target; fails only for impossible dates and unknown currencies. */
export const conversionFromBody = (
  body: z.infer<typeof ConvertTransactionBodySchema>,
): Result<ConversionTarget> => {
  if (body.type === "EXPENSE") {
    const { type, ...fields } = body;
    return map(expenseFromBody(fields), (expense) => ({ type, ...expense }));
  }
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  return ok(
    body.type === "INCOME"
      ? {
          type: body.type,
          description: body.description,
          ...when.value,
          categoryId: body.categoryId,
          amount: amount.value,
          accountId: body.accountId,
        }
      : {
          type: body.type,
          description: body.description,
          ...when.value,
          amount: amount.value,
          sourceAccountId: body.sourceAccountId,
          destinationAccountId: body.destinationAccountId,
        },
  );
};

/**
 * HU-E4-09: `memberId` defaults to the requester; `sourceAccountId` is the contributor's own account,
 * omitted (or null) only for a guest, who contributes outside the app.
 */
export const RecordFundContributionBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  amount: MoneySchema,
  fundAccountId: IdSchema,
  memberId: IdSchema.optional(),
  sourceAccountId: IdSchema.nullable().optional(),
});

/** A validated body as RecordFundContribution input; fails only for impossible dates and unknown currencies. */
export const fundContributionFromBody = (
  body: z.infer<typeof RecordFundContributionBodySchema>,
): Result<Omit<RecordFundContributionInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  return ok({
    description: body.description,
    ...when.value,
    amount: amount.value,
    fundAccountId: body.fundAccountId,
    memberId: body.memberId,
    sourceAccountId: body.sourceAccountId ?? null,
  });
};

/** HU-E5-02: `payerMemberId` paid `receivingMemberId`; both accounts are optional and never sent for a guest. */
export const RecordSettlementBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  amount: MoneySchema,
  payerMemberId: IdSchema,
  receivingMemberId: IdSchema,
  sourceAccountId: IdSchema.nullable().optional(),
  destinationAccountId: IdSchema.nullable().optional(),
});

/** A validated body as RecordSettlement input; fails only for impossible dates and unknown currencies. */
export const settlementFromBody = (
  body: z.infer<typeof RecordSettlementBodySchema>,
): Result<Omit<RecordSettlementInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  return ok({
    description: body.description,
    ...when.value,
    amount: amount.value,
    payerMemberId: body.payerMemberId,
    receivingMemberId: body.receivingMemberId,
    sourceAccountId: body.sourceAccountId ?? null,
    destinationAccountId: body.destinationAccountId ?? null,
  });
};

export const transactionDto = (tx: Transaction): z.infer<typeof TransactionSchema> => {
  const money = (minor: bigint) => ({ amount: minor.toString(), currency: tx.currency });
  return {
    id: tx.id,
    type: tx.type,
    description: tx.description,
    date: tx.date,
    occurredAt: tx.occurredAt?.toISOString() ?? null,
    timeZone: tx.timeZone,
    amount: money(tx.amount),
    categoryId: tx.categoryId,
    payments:
      tx.type === "EXPENSE"
        ? tx.payments.map((p) => ({ memberId: p.memberId, accountId: p.accountId, amount: money(p.amount) }))
        : [],
    shares:
      tx.type === "EXPENSE"
        ? tx.shares.map((s) => ({
            memberId: s.memberId,
            amount: money(s.amount),
            splitMethod: s.splitMethod,
          }))
        : [],
    sourceAccountId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.sourceAccountId : null,
    destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
    receivingMemberId: tx.type === "INCOME" || tx.type === "SETTLEMENT" ? tx.receivingMemberId : null,
    payerMemberId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.payerMemberId : null,
    createdBy: tx.createdBy,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
    version: tx.version,
  };
};

export const transactionHeaders = (tx: Transaction): [string, string][] => [
  ["etag", etagOf(tx.version)],
  ["location", `/api/v1/spaces/${tx.spaceId}/transactions/${tx.id}`],
];

/** HU-E4-10: non-blocking conditions of a recorded expense, as codes; the expense was recorded. */
export const WarningSchema = z.object({
  code: z.enum(["FundBalanceNegative"]),
  accountId: z.string(),
  /** The account balance after the expense. */
  balance: MoneySchema,
});
/** The expense response: the transaction plus its warnings (always present, usually empty). */
export const RecordedExpenseSchema = TransactionSchema.extend({ warnings: z.array(WarningSchema) });

/** The wire form of the warnings of a recorded expense; `currency` is the transaction's, which is the balance's. */
export const warningsDto = (
  warnings: readonly LedgerWarning[],
  currency: string,
): z.infer<typeof WarningSchema>[] =>
  warnings.map((warning) => ({
    code: warning.code,
    accountId: warning.accountId,
    balance: { amount: warning.balance.toString(), currency },
  }));

export const recordedExpenseDto = (recorded: RecordedExpense): z.infer<typeof RecordedExpenseSchema> => ({
  ...transactionDto(recorded.expense),
  warnings: warningsDto(recorded.warnings, recorded.expense.currency),
});

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

export const ListTransactionsQuerySchema = PaginationQuerySchema.extend({
  /** "2026-10" (monthly) or "2026-11 H1" (semi-monthly, URL-encoded); the current period when absent. */
  period: z.string().max(20).optional(),
  /** Comma-separated category ids. */
  categoryIds: z
    .string()
    .regex(new RegExp(`^${UUID}(,${UUID}){0,49}$`), { error: "Comma-separated category ids" })
    .optional(),
  payerMemberId: z.uuid().optional(),
  participantMemberId: z.uuid().optional(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"]).optional(),
});

export const ListTransactionsResponseSchema = z.object({
  period: PeriodSchema,
  totals: z.object({ expenses: MoneySchema, income: MoneySchema }),
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
});

/** Ruling P43: the position as the cursor's sort key `date|occurredAt|createdAt` (ISO UTC; empty without a time). */
const cursorOf = (p: TransactionPosition) => ({
  sortKey: [p.date, p.occurredAt?.toISOString() ?? "", p.createdAt.toISOString()].join("|"),
  id: p.id,
});

export const transactionPageDto = (
  page: TransactionPage,
): z.infer<typeof ListTransactionsResponseSchema> => ({
  period: periodDto(page.period),
  totals: {
    expenses: { amount: page.totals.expenses.toString(), currency: page.currency },
    income: { amount: page.totals.income.toString(), currency: page.currency },
  },
  items: page.items.map(transactionDto),
  nextCursor: page.nextPosition ? encodeCursor(cursorOf(page.nextPosition)) : null,
});

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const instantOf = (iso: string): Date | null => {
  const instant = ISO_INSTANT.test(iso) ? new Date(iso) : null;
  return instant !== null && !Number.isNaN(instant.getTime()) && instant.toISOString() === iso
    ? instant
    : null;
};

/** A cursor must hold a real date, real instants and a UUID, or the keyset query would fail its casts. */
export const positionFromCursor = (raw: string): Result<TransactionPosition> => {
  const cursor = decodeCursor(raw);
  if (!cursor.ok) return cursor;
  const [date = "", occurred = "", created = "", ...rest] = cursor.value.sortKey.split("|");
  const day = localDate(date);
  const occurredAt = occurred === "" ? null : instantOf(occurred);
  const createdAt = instantOf(created);
  const valid =
    day.ok &&
    rest.length === 0 &&
    createdAt !== null &&
    (occurred === "" || occurredAt !== null) &&
    isUuid(cursor.value.id);
  return valid
    ? ok({ date: day.value, occurredAt, createdAt, id: cursor.value.id })
    : err(domainError("InvalidCursor"));
};

/**
 * HU-E4-06, ruling P186: every field optional; an expense takes `accountId` (the requester pays it all from that
 * account) or `payments` and may send `split`, an income `accountId`, an own transfer `sourceAccountId` and
 * `destinationAccountId`.
 */
export const EditTransactionBodySchema = z
  .object({
    description: Description,
    date: z.iso.date().optional(),
    /** HU-E4-14: a new instant (any offset); null answers TimeRequired, since a time is never removed. */
    occurredAt: Instant.nullable().optional(),
    timeZone: TimeZoneName.optional(),
    categoryId: IdSchema.optional(),
    amount: MoneySchema.optional(),
    accountId: IdSchema.optional(),
    payments: z.array(PaymentBodySchema).max(MAX_PARTS).optional(),
    sourceAccountId: IdSchema.optional(),
    destinationAccountId: IdSchema.optional(),
    /** Ruling P186: how an expense is split, as when recording; recomputed on the edited amount. */
    split: SplitBodySchema.optional(),
  })
  .refine((body) => body.accountId === undefined || body.payments === undefined, {
    error: "Send accountId or payments, not both",
    path: ["payments"],
  });

/** A validated edit body as EditTransaction's changes; fails only for currencies the kernel does not know. */
export const editChangesFromBody = (body: z.infer<typeof EditTransactionBodySchema>): Result<EditChanges> => {
  const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  // Ruling P66: an explicit null `occurredAt` reaches the use case, which answers TimeRequired.
  const when = whenFromBody(body);
  if (!when.ok) return when;
  let payments: PaymentInput[] | undefined;
  if (body.payments !== undefined) {
    payments = [];
    for (const payment of body.payments) {
      const paid = moneyFromDto(payment.amount);
      if (!paid.ok) return paid;
      payments.push({ memberId: payment.memberId, accountId: payment.accountId ?? null, amount: paid.value });
    }
  }
  const split = splitFromBody(body.split);
  if (!split.ok) return split;
  return ok({
    description: body.description,
    ...when.value,
    categoryId: body.categoryId,
    amount: amount.value,
    accountId: body.accountId,
    payments,
    sourceAccountId: body.sourceAccountId,
    destinationAccountId: body.destinationAccountId,
    split: split.value,
  });
};

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["UPDATED", "DELETED", "RESTORED"]),
  actorUserId: z.string(),
  at: z.iso.datetime(),
  /**
   * Changed values as strings (amounts in minor units); an expense's `payments` and `shares` are JSON
   * arrays (D8, Task 0b), and a deletion lists every value it retires with `to: null`. Issue #195: a conversion's
   * deletion carries `convertedTo` (the new movement's id) and the new movement starts with an UPDATED entry carrying
   * `convertedFrom`; its undo writes the same keys back with `from` and `to` swapped.
   */
  changes: z.record(z.string(), z.object({ from: z.string().nullable(), to: z.string().nullable() })),
});
export const ListAuditResponseSchema = z.object({ items: z.array(AuditEntrySchema) });

export const auditEntryDto = (entry: AuditEntry): z.infer<typeof AuditEntrySchema> => ({
  id: entry.id,
  action: entry.action,
  actorUserId: entry.actorUserId,
  at: entry.at.toISOString(),
  changes: entry.changes,
});

/** HU-E1-13: whom the requester splits with: a member of a space they share, or a new guest. */
const DirectCounterpartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MEMBER"), memberId: IdSchema }),
  z.object({
    kind: z.literal("GUEST"),
    displayName: z.string().max(200),
    contactEmail: z.email().max(254).optional(),
  }),
]);

/**
 * HU-E1-13: the requester pays the whole amount from one of their own accounts and it takes the default
 * split with the other person (spec 5.3, HU-E6-08): EQUAL, as a new direct space has no plan, and
 * BY_ALLOCATION once an ACTIVE plan of the space allocates the category's line. The category is a catalog
 * key of the default categories every direct space is seeded with (HU-E3-01, D11), since a new space's
 * category ids are not known yet.
 */
export const DirectSplitBodySchema = z.object({
  counterpart: DirectCounterpartSchema,
  description: Description,
  date: z.iso.date().optional(),
  occurredAt: Instant.nullable().optional(),
  timeZone: TimeZoneName.optional(),
  categoryKey: z.string().min(1).max(64),
  amount: MoneySchema,
  accountId: IdSchema,
});
type DirectSplitBody = z.infer<typeof DirectSplitBodySchema>;

/** A direct split's expense as the composition root hands it to RecordExpenseByCategoryKey. */
export type DirectSplitExpense = Pick<
  RecordExpenseInput,
  "description" | "date" | "occurredAt" | "timeZone" | "amount" | "accountId"
> & {
  readonly categoryKey: string;
};

export const directSplitFromBody = (
  body: DirectSplitBody,
): Result<{ counterpart: DirectSplitCounterpart; expense: DirectSplitExpense }> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const when = whenFromBody(body);
  if (!when.ok) return when;
  const { counterpart } = body;
  return ok({
    counterpart:
      counterpart.kind === "MEMBER"
        ? { memberId: counterpart.memberId }
        : { guest: { displayName: counterpart.displayName, contactEmail: counterpart.contactEmail } },
    expense: {
      description: body.description,
      ...when.value,
      amount: amount.value,
      accountId: body.accountId,
      categoryKey: body.categoryKey,
    },
  });
};

/** The direct space the split was recorded in, whether this split created it, and the expense. */
export const DirectSplitSchema = z.object({
  spaceId: z.string(),
  created: z.boolean(),
  expense: RecordedExpenseSchema,
});

export const directSplitDto = (split: DirectSplit<RecordedExpense>): z.infer<typeof DirectSplitSchema> => ({
  spaceId: split.spaceId,
  created: split.created,
  expense: recordedExpenseDto(split.recorded),
});

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });
const TransactionPath = SpacePath.extend({ transactionId: z.string() });
const IfMatchHeader = z.object({ "if-match": z.string().optional() });

const recording = (
  operationId: string,
  summary: string,
  body: z.ZodType,
  errors: Record<string, string>,
  response: z.ZodType = TransactionSchema,
) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: SpacePath, header: IdempotencyHeader },
    requestBody: { content: jsonContent(body) },
    responses: {
      "201": {
        description: "The recorded transaction; ETag carries its version",
        content: jsonContent(response),
      },
      ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", ...errors }),
    },
  },
});

const invalidMoney =
  "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey";

export const ledgerPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/expenses": recording(
    "recordExpense",
    "Record an expense paid by members (registered or guest) or by the shared fund, shared among members",
    RecordExpenseBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409":
        "AccountArchived, CategoryArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict, SharesDoNotMatchAmount, GuestHasNoAccounts, MixedFundPayment",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountRequired, PaymentsRequired, ParticipantsRequired, NotASpaceMember, InvalidSplit, InvalidFundAccount, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
    },
    RecordedExpenseSchema,
  ),
  "/api/v1/spaces/{spaceId}/incomes": recording(
    "recordIncome",
    "Record income into one of the requester's accounts in this space",
    RecordIncomeBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409": "AccountArchived, CategoryArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountNotInSpace, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
    },
  ),
  "/api/v1/spaces/{spaceId}/transfers": recording(
    "recordTransfer",
    "Move money between two of the requester's accounts in this space",
    RecordTransferBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "SameAccountTransfer, AccountArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict",
      "422": `${invalidMoney}, AccountNotOwned, AccountNotInSpace, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
    },
  ),
  "/api/v1/spaces/{spaceId}/fund-contributions": recording(
    "recordFundContribution",
    "Contribute to the space's shared fund from a member's own account (a guest from outside the app)",
    RecordFundContributionBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409":
        "AccountArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict, SameAccountTransfer, GuestHasNoAccounts",
      "422": `${invalidMoney}, AccountNotOwned, AccountRequired, InvalidFundAccount, NotASpaceMember, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
    },
  ),
  "/api/v1/spaces/{spaceId}/settlements": recording(
    "recordSettlement",
    "Record that one member paid another to settle up; accounts are optional",
    RecordSettlementBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "AccountArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict, GuestHasNoAccounts",
      "422": `${invalidMoney}, AccountNotOwned, NotASpaceMember, InvalidSettlementParties, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
    },
  ),
  "/api/v1/spaces/{spaceId}/transactions": {
    get: {
      operationId: "listTransactions",
      summary: "Transactions of one period, newest first, with period totals (the monthly view)",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListTransactionsQuerySchema },
      responses: {
        "200": {
          description: "One page of the period",
          content: jsonContent(ListTransactionsResponseSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidCursor, InvalidPeriodLabel",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}": {
    get: {
      operationId: "getTransaction",
      summary: "One transaction; ETag carries its version",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": { description: "The transaction", content: jsonContent(TransactionSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, TransactionNotFound" }),
      },
    },
    patch: {
      operationId: "editTransaction",
      summary:
        "Change description, date, time, category, amount, accounts, who paid or how it is split; send If-Match with the current ETag",
      ...securedByUser,
      requestParams: { path: TransactionPath, header: IfMatchHeader },
      requestBody: { content: jsonContent(EditTransactionBodySchema) },
      responses: {
        "200": {
          description: "The edited transaction with its new ETag",
          content: jsonContent(TransactionSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound, CategoryNotFound, AccountNotFound",
          "409":
            "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, SpaceArchived, TransferHasNoCategory, SettlementHasNoCategory, AccountArchived, SameAccountTransfer, GuestHasNoAccounts, MixedFundPayment, FieldNotEditable",
          "412": "PreconditionFailed",
          "422":
            "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency, AccountNotOwned, AccountNotInSpace, AccountRequired, PaymentsRequired, ParticipantsRequired, InvalidSplit, InvalidFundAccount, NotASpaceMember, DateTimeMismatch, TimeRequired, InvalidTimeZone",
        }),
      },
    },
    delete: {
      operationId: "deleteTransaction",
      summary: "Soft-delete a transaction; it leaves lists, balances and totals but keeps its audit trail",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "204": { description: "Deleted" },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound",
          "409": "PeriodClosed, SpaceArchived",
          "422": "NotASpaceMember",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/audit": {
    get: {
      operationId: "listTransactionAudit",
      summary: "Who changed or deleted a transaction, oldest first",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": { description: "Audit entries", content: jsonContent(ListAuditResponseSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, TransactionNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/restore": {
    post: {
      operationId: "restoreTransaction",
      summary:
        "Undo a deletion: the transaction returns to lists, balances and totals; restoring a live one changes nothing",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": {
          description: "The restored transaction with its new ETag",
          content: jsonContent(TransactionSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound",
          "409": "PeriodClosed, SpaceArchived",
          "412": "PreconditionFailed",
          "422": "NotASpaceMember",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/convert": {
    post: {
      operationId: "convertTransaction",
      summary:
        "Change an expense, income or transfer into another of the three: the new movement is recorded and the original soft-deleted in one transaction, linked both ways in the audit; send If-Match with the current ETag",
      ...securedByUser,
      requestParams: { path: TransactionPath, header: IfMatchHeader },
      requestBody: { content: jsonContent(ConvertTransactionBodySchema) },
      responses: {
        "201": {
          description: "The new movement; ETag carries its version",
          content: jsonContent(TransactionSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound, CategoryNotFound, AccountNotFound",
          "409":
            "TransactionNotConvertible, PeriodClosed, SpaceArchived, AccountArchived, CategoryArchived, SameAccountTransfer, SharesDoNotMatchAmount, GuestHasNoAccounts, MixedFundPayment",
          "412": "PreconditionFailed",
          "422": `${invalidMoney}, SameTransactionType, CategoryRequired, AccountNotOwned, AccountNotInSpace, AccountRequired, PaymentsRequired, ParticipantsRequired, NotASpaceMember, InvalidSplit, InvalidFundAccount, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/transactions/{transactionId}/convert/undo": {
    post: {
      operationId: "undoTransactionConversion",
      summary:
        "Undo a conversion: the original returns as it was and what it became is soft-deleted; undoing for a live original changes nothing",
      ...securedByUser,
      requestParams: { path: TransactionPath },
      responses: {
        "200": {
          description: "The restored original with its new ETag",
          content: jsonContent(TransactionSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, TransactionNotFound",
          "409": "TransactionNotConverted, PeriodClosed, SpaceArchived",
          "412": "PreconditionFailed",
          "422": "NotASpaceMember",
        }),
      },
    },
  },
  "/api/v1/direct-splits": {
    post: {
      operationId: "splitWithPerson",
      summary: "Split an expense with one person through your two-member direct space, created on first use",
      ...securedByUser,
      requestParams: { header: IdempotencyHeader },
      requestBody: { content: jsonContent(DirectSplitBodySchema) },
      responses: {
        "201": {
          description: "The direct space, whether this split created it, and the recorded expense",
          content: jsonContent(DirectSplitSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "MemberNotFound, CategoryNotFound, AccountNotFound",
          "409":
            "MemberNameTaken, AccountArchived, CategoryArchived, PeriodClosed, SpaceArchived, IdempotencyKeyConflict",
          "422": `${invalidMoney}, InvalidMemberName, InvalidDirectCounterpart, AccountNotOwned, DateTimeMismatch, TimeRequired, InvalidTimeZone`,
        }),
      },
    },
  },
};
