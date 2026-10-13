import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import { etagOf } from "@/shared/http/etag";
import type { Transaction } from "../application";

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

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });

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
};
