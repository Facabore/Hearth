import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  basisPointsOf,
  jsonContent,
  moneyFromDto,
  MoneySchema,
  PercentSchema,
  percentOf,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import { localDate, ok, type Result } from "@/shared/kernel";
import type {
  DefineRecurrenceInput,
  Occurrence,
  Recurrence,
  RecurrenceSplit,
  RecurrenceTemplate,
  RecurrenceView,
  TemplateInput,
} from "../application";

const Id = z.string().min(1).max(64);
/** Participants per split: bounds the payload; membership is checked by the domain. */
const MAX_PARTS = 100;
const MODES = ["AUTO", "CONFIRM"] as const;

/** Request shape: any integer days, so the domain answers InvalidPeriodPolicy instead of ValidationFailed (HU-E1-03). */
export const ScheduleInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int() }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int(), day2: z.number().int() }),
]);

/**
 * Ruling P23: EQUAL among the chosen members, or by percentage or share units; EXACT is not offered. Without a split,
 * each occurrence takes its default split (spec 5.3: BY_ALLOCATION with the ACTIVE plan of its period, else EQUAL).
 */
export const RecurrenceSplitSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("EQUAL"), participants: z.array(z.object({ memberId: Id })).max(MAX_PARTS) }),
  z.object({
    method: z.literal("PERCENT"),
    participants: z.array(z.object({ memberId: Id, percent: PercentSchema })).max(MAX_PARTS),
  }),
  z.object({
    method: z.literal("SHARES"),
    participants: z.array(z.object({ memberId: Id, units: z.number().int() })).max(MAX_PARTS),
  }),
]);
type RecurrenceSplitDto = z.infer<typeof RecurrenceSplitSchema>;

export const splitOf = (split: RecurrenceSplitDto): RecurrenceSplit => {
  switch (split.method) {
    case "EQUAL":
      return { method: "EQUAL", participants: split.participants.map((p) => ({ memberId: p.memberId })) };
    case "PERCENT":
      return {
        method: "PERCENT",
        participants: split.participants.map((p) => ({
          memberId: p.memberId,
          basisPoints: basisPointsOf(p.percent),
        })),
      };
    case "SHARES":
      return {
        method: "SHARES",
        participants: split.participants.map((p) => ({ memberId: p.memberId, units: p.units })),
      };
  }
};

/**
 * HU-E4-11, spec 5.2: what every occurrence records besides its date and amount, fixed once defined (ruling P22). An
 * expense is paid by a member (a guest sends no `accountId`) or by the fund (`memberId` null, `accountId` the fund);
 * a contribution's member (null or absent) defaults to the requester and a guest sends no `sourceAccountId`; a null or
 * absent `split` is the default split of each occurrence, as in the responses. Each type names exactly its own
 * references; like every body here, a key that belongs to another type is stripped and never read.
 */
const TemplateBodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("EXPENSE"),
    categoryId: Id,
    payer: z.object({ memberId: Id.nullable(), accountId: Id.nullable().optional() }),
    split: RecurrenceSplitSchema.nullable().optional(),
  }),
  z.object({ type: z.literal("INCOME"), categoryId: Id, accountId: Id }),
  z.object({ type: z.literal("TRANSFER"), sourceAccountId: Id, destinationAccountId: Id }),
  z.object({
    type: z.literal("FUND_CONTRIBUTION"),
    fundAccountId: Id,
    memberId: Id.nullable().optional(),
    sourceAccountId: Id.nullable().optional(),
  }),
]);

/** HU-E4-11: `amount` is what AUTO records each time and what CONFIRM suggests; without `endDate` it never ends. */
export const DefineRecurrenceBodySchema = z.object({
  // Length rules live in the domain (InvalidDescription, 1–200 characters); the cap only bounds payload size.
  description: z.string().max(1000),
  amount: MoneySchema,
  template: TemplateBodySchema,
  schedule: ScheduleInputSchema,
  mode: z.enum(MODES),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
});
type DefineRecurrenceBody = z.infer<typeof DefineRecurrenceBodySchema>;

const templateOf = (body: DefineRecurrenceBody["template"]): TemplateInput => {
  switch (body.type) {
    case "EXPENSE":
      return {
        type: "EXPENSE",
        categoryId: body.categoryId,
        payer: { memberId: body.payer.memberId, accountId: body.payer.accountId ?? null },
        split: body.split == null ? null : splitOf(body.split),
      };
    case "INCOME":
      return { type: "INCOME", categoryId: body.categoryId, accountId: body.accountId };
    case "TRANSFER":
      return {
        type: "TRANSFER",
        sourceAccountId: body.sourceAccountId,
        destinationAccountId: body.destinationAccountId,
      };
    case "FUND_CONTRIBUTION":
      return {
        type: "FUND_CONTRIBUTION",
        fundAccountId: body.fundAccountId,
        memberId: body.memberId ?? undefined,
        sourceAccountId: body.sourceAccountId ?? null,
      };
  }
};

/** A validated body as DefineRecurrence input; fails only for impossible dates and currencies the kernel does not know. */
export const recurrenceFromBody = (
  body: DefineRecurrenceBody,
): Result<Omit<DefineRecurrenceInput, "spaceId" | "userId">> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const startDate = localDate(body.startDate);
  if (!startDate.ok) return startDate;
  const endDate = body.endDate === undefined || body.endDate === null ? ok(null) : localDate(body.endDate);
  if (!endDate.ok) return endDate;
  return ok({
    description: body.description,
    amount: amount.value,
    template: templateOf(body.template),
    schedule: body.schedule,
    mode: body.mode,
    startDate: startDate.value,
    endDate: endDate.value,
  });
};

const TYPES = ["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"] as const;
const OCCURRENCE_STATUSES = ["RECORDED", "PENDING", "SKIPPED"] as const;

/** Spec 5.2: a recurrence's schedule follows the PeriodPolicy anchor rules (HU-E1-03). */
export const ScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int().min(1).max(31) }),
  z.object({
    kind: z.literal("SEMI_MONTHLY"),
    day1: z.number().int().min(1).max(31),
    day2: z.number().int().min(1).max(31),
  }),
]);

const splitDto = (split: RecurrenceSplit): RecurrenceSplitDto => {
  switch (split.method) {
    case "EQUAL":
      return { method: "EQUAL", participants: split.participants.map((p) => ({ memberId: p.memberId })) };
    case "PERCENT":
      return {
        method: "PERCENT",
        participants: split.participants.map((p) => ({
          memberId: p.memberId,
          percent: percentOf(p.basisPoints),
        })),
      };
    case "SHARES":
      return {
        method: "SHARES",
        participants: split.participants.map((p) => ({ memberId: p.memberId, units: p.units })),
      };
  }
};

/** HU-E4-12, HU-E4-13: one date of a recurrence and what became of it (ruling P31). */
export const OccurrenceSchema = z.object({
  id: z.string(),
  recurrenceId: z.string(),
  type: z.enum(TYPES),
  description: z.string(),
  date: z.iso.date(),
  status: z.enum(OCCURRENCE_STATUSES),
  /** RECORDED: the amount recorded; PENDING: the suggested estimate; SKIPPED: what it would have recorded. */
  amount: MoneySchema,
  categoryId: z.string().nullable(),
  /** The transaction recorded for it; null unless RECORDED. */
  transactionId: z.string().nullable(),
  /** SKIPPED only: PeriodClosed, PayerLeft, CreatorLeft or the refusing code; null when a member skipped it. */
  reason: z.string().nullable(),
});

/**
 * HU-E4-11: a recurrence. Its template's references follow the Transaction fields: an expense's paying member (null:
 * the fund) and paying account, an income's account, a transfer's two accounts, a contribution's member, source and fund.
 */
export const RecurrenceSchema = z.object({
  id: z.string(),
  type: z.enum(TYPES),
  description: z.string(),
  amount: MoneySchema,
  mode: z.enum(MODES),
  schedule: ScheduleSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
  /** PAUSED only: null when a member paused it, else PayerLeft, CreatorLeft or the code that refused an occurrence. */
  pauseReason: z.string().nullable(),
  /** The next date it will record; null while paused or once ended. */
  nextOccurrence: z.iso.date().nullable(),
  categoryId: z.string().nullable(),
  payerMemberId: z.string().nullable(),
  sourceAccountId: z.string().nullable(),
  destinationAccountId: z.string().nullable(),
  /** An expense's split; null is the default split of each occurrence (ruling P23). */
  split: RecurrenceSplitSchema.nullable(),
  /** The latest date it considered: the transaction recorded for it, or why it was skipped (ruling P31). */
  lastOccurrence: z
    .object({
      id: z.string(),
      date: z.iso.date(),
      status: z.enum(OCCURRENCE_STATUSES),
      amount: MoneySchema,
      transactionId: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});

const references = (template: RecurrenceTemplate) => {
  switch (template.type) {
    case "EXPENSE":
      return {
        categoryId: template.categoryId,
        payerMemberId: template.payer.memberId,
        sourceAccountId: template.payer.accountId,
        destinationAccountId: null,
        split: template.split === null ? null : splitDto(template.split),
      };
    case "INCOME":
      return {
        categoryId: template.categoryId,
        payerMemberId: null,
        sourceAccountId: null,
        destinationAccountId: template.accountId,
        split: null,
      };
    case "TRANSFER":
      return {
        categoryId: null,
        payerMemberId: null,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.destinationAccountId,
        split: null,
      };
    case "FUND_CONTRIBUTION":
      return {
        categoryId: null,
        payerMemberId: template.memberId,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.fundAccountId,
        split: null,
      };
  }
};

export const occurrenceDto = (
  occurrence: Occurrence,
  recurrence: Recurrence,
): z.infer<typeof OccurrenceSchema> => ({
  id: occurrence.id,
  recurrenceId: occurrence.recurrenceId,
  type: recurrence.template.type,
  description: recurrence.description,
  date: occurrence.date,
  status: occurrence.status,
  amount: { amount: occurrence.amount.toString(), currency: recurrence.currency },
  categoryId: references(recurrence.template).categoryId,
  transactionId: occurrence.transactionId,
  reason: occurrence.reason,
});

export const recurrenceDto = (view: RecurrenceView): z.infer<typeof RecurrenceSchema> => {
  const { recurrence, lastOccurrence: last } = view;
  return {
    id: recurrence.id,
    type: recurrence.template.type,
    description: recurrence.description,
    amount: { amount: recurrence.amount.toString(), currency: recurrence.currency },
    mode: recurrence.mode,
    schedule: recurrence.schedule,
    startDate: recurrence.startDate,
    endDate: recurrence.endDate,
    status: view.status,
    pauseReason: view.status === "PAUSED" ? recurrence.pauseReason : null,
    nextOccurrence: view.nextOccurrence,
    ...references(recurrence.template),
    lastOccurrence:
      last === null
        ? null
        : {
            id: last.id,
            date: last.date,
            status: last.status,
            amount: { amount: last.amount.toString(), currency: recurrence.currency },
            transactionId: last.transactionId,
            reason: last.reason,
          },
    createdBy: recurrence.createdBy,
    createdAt: recurrence.createdAt.toISOString(),
  };
};

/** The Location header of a new recurrence (HU-E4-11). */
export const recurrenceHeaders = (view: RecurrenceView): [string, string][] => [
  ["location", `/api/v1/spaces/${view.recurrence.spaceId}/recurrences/${view.recurrence.id}`],
];

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });

const recurrenceResponse = (description: string) => ({ description, content: jsonContent(RecurrenceSchema) });
/** What checking a template answers (ruling P21): the codes of the record use cases. */
const TEMPLATE_404 = "CategoryNotFound, AccountNotFound";
const TEMPLATE_409 = "AccountArchived, CategoryArchived, GuestHasNoAccounts, SameAccountTransfer";
const TEMPLATE_422 =
  "AccountNotOwned, AccountNotInSpace, AccountRequired, InvalidFundAccount, NotASpaceMember, InvalidSplit, ParticipantsRequired";
/** HU-E4-11: the two ways a definition is invalid by itself, whatever its template. */
const INVALID_RECURRENCE =
  "InvalidRecurrence (an end date before the start; no schedule date from the start, or from the day it is defined if that is later, through the end date)";

export const recurrencesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/recurrences": {
    post: {
      operationId: "defineRecurrence",
      summary:
        "Define a recurring expense, income, transfer or fund contribution on a MONTHLY or SEMI_MONTHLY schedule",
      ...securedByUser,
      requestParams: { path: SpacePath, header: IdempotencyHeader },
      requestBody: { content: jsonContent(DefineRecurrenceBodySchema) },
      responses: {
        "201": recurrenceResponse("The recurrence; Location names it"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, ${TEMPLATE_404}`,
          "409": `${TEMPLATE_409}, SpaceArchived, IdempotencyKeyConflict`,
          "422": `ValidationFailed, InvalidAmount, InvalidDate, InvalidDescription, InvalidPeriodPolicy, ${INVALID_RECURRENCE}, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey, ${TEMPLATE_422}`,
        }),
      },
    },
  },
};
