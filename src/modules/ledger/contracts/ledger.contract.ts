import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  jsonContent,
  MoneySchema,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import { etagOf } from "@/shared/http/etag";
import { decodeCursor, encodeCursor, PaginationQuerySchema } from "@/shared/http/pagination";
import { domainError, err, isUuid, localDate, ok, type Result } from "@/shared/kernel";
import type { AuditEntry, Transaction, TransactionPage, TransactionPosition } from "../application";

const Id = z.string().min(1).max(64);
// Length rules live in the domain (InvalidDescription, 200 characters); the cap only bounds payload size.
const Description = z.string().max(1000).optional();

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
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  description: z.string(),
  date: z.iso.date(),
  amount: MoneySchema,
  categoryId: z.string().nullable(),
  payments: z.array(PaymentSchema),
  shares: z.array(ShareSchema),
  sourceAccountId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  receivingMemberId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Same value as the ETag; send it back in If-Match. */
  version: z.number().int(),
});

/** M1 shape (HU-E4-01): one payment by the requester from `accountId`. HU-E4-07 adds payments[] and split. */
export const RecordExpenseBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema,
  accountId: Id,
});
/** `accountId` is the requester's account in this space that receives the money (HU-E4-02). */
export const RecordIncomeBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema,
  accountId: Id,
});
export const RecordTransferBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  amount: MoneySchema,
  sourceAccountId: Id,
  destinationAccountId: Id,
});

export const transactionDto = (tx: Transaction): z.infer<typeof TransactionSchema> => {
  const money = (minor: bigint) => ({ amount: minor.toString(), currency: tx.currency });
  return {
    id: tx.id,
    type: tx.type,
    description: tx.description,
    date: tx.date,
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
    sourceAccountId: tx.type === "TRANSFER" ? tx.sourceAccountId : null,
    destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
    receivingMemberId: tx.type === "INCOME" ? tx.receivingMemberId : null,
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
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).optional(),
});

export const ListTransactionsResponseSchema = z.object({
  period: PeriodSchema,
  totals: z.object({ expenses: MoneySchema, income: MoneySchema }),
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable(),
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
  nextCursor: page.nextPosition
    ? encodeCursor({ sortKey: page.nextPosition.date, id: page.nextPosition.id })
    : null,
});

/** A cursor must hold a real date and a UUID, or the keyset query would fail its casts. */
export const positionFromCursor = (raw: string): Result<TransactionPosition> => {
  const cursor = decodeCursor(raw);
  if (!cursor.ok) return cursor;
  const date = localDate(cursor.value.sortKey);
  return date.ok && isUuid(cursor.value.id)
    ? ok({ date: date.value, id: cursor.value.id })
    : err(domainError("InvalidCursor"));
};

export const EditTransactionBodySchema = z.object({
  description: Description,
  date: z.iso.date().optional(),
  categoryId: Id.optional(),
  amount: MoneySchema.optional(),
});

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["UPDATED", "DELETED"]),
  actorUserId: z.string(),
  at: z.iso.datetime(),
  /** Changed fields with their previous and new values; amounts in minor units as strings. */
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

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });
const TransactionPath = SpacePath.extend({ transactionId: z.string() });
const IfMatchHeader = z.object({ "if-match": z.string().optional() });

const recording = (
  operationId: string,
  summary: string,
  body: z.ZodType,
  errors: Record<string, string>,
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
        content: jsonContent(TransactionSchema),
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
    "Record an expense paid from one of the requester's accounts",
    RecordExpenseBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409": "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned`,
    },
  ),
  "/api/v1/spaces/{spaceId}/incomes": recording(
    "recordIncome",
    "Record income into one of the requester's accounts in this space",
    RecordIncomeBodySchema,
    {
      "404": "SpaceNotFound, CategoryNotFound, AccountNotFound",
      "409": "AccountArchived, CategoryArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, CategoryRequired, AccountNotOwned, AccountNotInSpace`,
    },
  ),
  "/api/v1/spaces/{spaceId}/transfers": recording(
    "recordTransfer",
    "Move money between two of the requester's accounts in this space",
    RecordTransferBodySchema,
    {
      "404": "SpaceNotFound, AccountNotFound",
      "409": "SameAccountTransfer, AccountArchived, PeriodClosed, IdempotencyKeyConflict",
      "422": `${invalidMoney}, AccountNotOwned, AccountNotInSpace`,
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
      summary: "Change description, date, category or amount; send If-Match with the current ETag",
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
          "404": "SpaceNotFound, TransactionNotFound, CategoryNotFound",
          "409": "SharesDoNotMatchAmount, CategoryArchived, PeriodClosed, TransferHasNoCategory",
          "412": "PreconditionFailed",
          "422":
            "ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, CurrencyMismatch, UnknownCurrency",
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
          "409": "PeriodClosed",
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
};
