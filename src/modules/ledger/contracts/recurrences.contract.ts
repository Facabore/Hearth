import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  IdSchema,
  jsonContent,
  moneyFromDto,
  MoneySchema,
  optionalLocalDate,
  percentOf,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import { localDate, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type {
  ConfirmedOccurrence,
  DefineRecurrenceInput,
  RecurrenceEdit,
  Occurrence,
  Recurrence,
  RecurrenceSplit,
  RecurrenceTemplate,
  RecurrenceView,
  TemplateInput,
} from "../application";
import { RecordedExpenseSchema, transactionDto, warningsDto } from "./ledger.contract";
import { EqualSplitSchema, PercentSplitSchema, SharesSplitSchema, splitOf } from "./split-body";

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
  EqualSplitSchema,
  PercentSplitSchema,
  SharesSplitSchema,
]);
type RecurrenceSplitDto = z.infer<typeof RecurrenceSplitSchema>;

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
    categoryId: IdSchema,
    payer: z.object({ memberId: IdSchema.nullable(), accountId: IdSchema.nullable().optional() }),
    split: RecurrenceSplitSchema.nullable().optional(),
  }),
  z.object({ type: z.literal("INCOME"), categoryId: IdSchema, accountId: IdSchema }),
  z.object({ type: z.literal("TRANSFER"), sourceAccountId: IdSchema, destinationAccountId: IdSchema }),
  z.object({
    type: z.literal("FUND_CONTRIBUTION"),
    fundAccountId: IdSchema,
    memberId: IdSchema.nullable().optional(),
    sourceAccountId: IdSchema.nullable().optional(),
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

/** HU-E4-11: the space's recurrences in the order they were defined (not paginated, ruling P28). */
export const RecurrenceListSchema = z.object({ items: z.array(RecurrenceSchema) });

/** HU-E4-11: how many upcoming dates to list, 1–24 (3 by default). */
export const UpcomingOccurrencesQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(24).default(3),
});
export const UpcomingOccurrencesSchema = z.object({ dates: z.array(z.iso.date()) });

/** A key the definition takes and an edit cannot change: sent, it answers 422 ValidationFailed naming the field. */
const FIXED_ONCE_DEFINED = z
  .never({ error: "Cannot be changed once the recurrence is defined" })
  .optional()
  .meta({ description: "Cannot be sent: an edit does not change it (422 ValidationFailed)" });

/**
 * HU-E4-11: what a PATCH may change (ruling P22). Unknown keys are stripped, as in every body here, but the type, the
 * payer and the accounts stay as defined, so the keys that would name them are refused instead of being ignored: a
 * client never believes it changed what no edit can change. They are the definition's `template` and, flat, the keys
 * inside it and the ones a read answers with, as well as `startDate`.
 */
export const UpdateRecurrenceBodySchema = z.object({
  description: z.string().max(1000).optional(),
  amount: MoneySchema.optional(),
  categoryId: IdSchema.optional(),
  /** Null returns to the default split of each occurrence (ruling P23). */
  split: RecurrenceSplitSchema.nullable().optional(),
  schedule: ScheduleInputSchema.optional(),
  mode: z.enum(MODES).optional(),
  /** Null removes the end date. */
  endDate: z.iso.date().nullable().optional(),
  template: FIXED_ONCE_DEFINED,
  type: FIXED_ONCE_DEFINED,
  payer: FIXED_ONCE_DEFINED,
  payerMemberId: FIXED_ONCE_DEFINED,
  accountId: FIXED_ONCE_DEFINED,
  fundAccountId: FIXED_ONCE_DEFINED,
  memberId: FIXED_ONCE_DEFINED,
  sourceAccountId: FIXED_ONCE_DEFINED,
  destinationAccountId: FIXED_ONCE_DEFINED,
  startDate: FIXED_ONCE_DEFINED,
});

/** A validated PATCH body as UpdateRecurrence changes; fails only for impossible dates and unknown currencies. */
export const recurrenceEditFromBody = (
  body: z.infer<typeof UpdateRecurrenceBodySchema>,
): Result<RecurrenceEdit> => {
  const amount = body.amount === undefined ? ok(undefined) : moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const endDate =
    body.endDate === undefined || body.endDate === null ? ok(body.endDate) : localDate(body.endDate);
  if (!endDate.ok) return endDate;
  return ok({
    description: body.description,
    amount: amount.value,
    categoryId: body.categoryId,
    split: body.split === undefined ? undefined : body.split === null ? null : splitOf(body.split),
    schedule: body.schedule,
    mode: body.mode,
    endDate: endDate.value,
  });
};

/** #115: the new end date of an ended recurrence; it is required, and null is none: the recurrence never ends. */
export const ExtendRecurrenceBodySchema = z.object({ endDate: z.iso.date().nullable() });

/** A validated extension's end date; fails only for an impossible date. */
export const extensionEndDateFromBody = (
  body: z.infer<typeof ExtendRecurrenceBodySchema>,
): Result<LocalDate | null> => (body.endDate === null ? ok(null) : localDate(body.endDate));

/** HU-E4-13: the space's pending occurrences, earliest date first (not paginated, ruling P28). */
export const PendingOccurrenceListSchema = z.object({ items: z.array(OccurrenceSchema) });

/** HU-E4-13: the real amount, and optionally another day of the occurrence's period. */
export const ConfirmOccurrenceBodySchema = z.object({
  amount: MoneySchema,
  date: z.iso.date().optional(),
});

/** A validated confirmation; fails for a date before 1900, which the kernel refuses, and for currencies it does not know. */
export const confirmationFromBody = (
  body: z.infer<typeof ConfirmOccurrenceBodySchema>,
): Result<{ amount: Money; date?: LocalDate }> => {
  const amount = moneyFromDto(body.amount);
  if (!amount.ok) return amount;
  const date = optionalLocalDate(body.date);
  return date.ok ? ok({ amount: amount.value, date: date.value }) : date;
};

/** The confirmation's answer: the recorded transaction and its warnings, as a recorded expense answers (HU-E4-10). */
export const recordedOccurrenceDto = (
  confirmed: ConfirmedOccurrence,
): z.infer<typeof RecordedExpenseSchema> => ({
  ...transactionDto(confirmed.transaction),
  warnings: warningsDto(confirmed.warnings, confirmed.transaction.currency),
});

/** The Location header of a new recurrence (HU-E4-11). */
export const recurrenceHeaders = (view: RecurrenceView): [string, string][] => [
  ["location", `/api/v1/spaces/${view.recurrence.spaceId}/recurrences/${view.recurrence.id}`],
];

const SpacePath = z.object({ spaceId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });
const RecurrencePath = SpacePath.extend({ recurrenceId: z.string() });
const OccurrencePath = SpacePath.extend({ occurrenceId: z.string() });

const recurrenceResponse = (description: string) => ({ description, content: jsonContent(RecurrenceSchema) });
/** What checking a template answers (ruling P21): the codes of the record use cases. */
const TEMPLATE_404 = "CategoryNotFound, AccountNotFound";
const TEMPLATE_409 = "AccountArchived, CategoryArchived, GuestHasNoAccounts, SameAccountTransfer";
const templateRefusals422 = (accountNotOwned = "AccountNotOwned", notASpaceMember = "NotASpaceMember") =>
  `${accountNotOwned}, AccountNotInSpace, AccountRequired, InvalidFundAccount, ${notASpaceMember}, InvalidSplit, ParticipantsRequired`;
const TEMPLATE_422 = templateRefusals422();
/**
 * HU-E4-11: what an edit or a resume refuses because of the recurrence's creator, not the requester (rulings P21, P26,
 * D9 extended); the problem's `member` is "creator" when the creator is the one refused.
 */
const CREATOR_403 =
  'InsufficientRole (the requester may not manage it; with member "creator", the recurrence\'s creator no longer holds money.record)';
const creatorRefusals422 = (only: string, notAMember: string) =>
  templateRefusals422(
    `AccountNotOwned (it moves money into or out of its creator's own account: only its creator ${only} it)`,
    `NotASpaceMember (${notAMember}; with member "creator", the recurrence's creator left)`,
  );
/** What an edit refuses as NotASpaceMember: a payer or split participant who left, or a new one who never was. */
const NOT_A_MEMBER_ON_EDIT =
  "a payer or a split participant is not a member, whether they left or never were";
const LEFT_ON_RESUME = "a payer or a split participant left";
/** HU-E4-11: what makes an edit invalid by itself; an edit that leaves no date to record ends the recurrence instead. */
const INVALID_EDIT =
  "InvalidRecurrence (an end date before the start; a category or split its type does not have)";
/** HU-E4-11: the two ways a definition is invalid by itself, whatever its template. */
const INVALID_RECURRENCE =
  "InvalidRecurrence (an end date before the start; no schedule date from the start, or from the day it is defined if that is later, through the end date)";

/** HU-E4-11: a move of a recurrence; no body, and the answer is the recurrence after it. */
const recurrenceMove = (operationId: string, summary: string, errors: Record<string, string> = {}) => ({
  post: {
    operationId,
    summary,
    ...securedByUser,
    requestParams: { path: RecurrencePath },
    responses: {
      "200": recurrenceResponse("The recurrence after the move"),
      ...problems({
        "401": "Unauthenticated",
        "403": "InsufficientRole",
        "404": "SpaceNotFound, RecurrenceNotFound",
        "409": "InvalidRecurrenceTransition, SpaceArchived",
        ...errors,
      }),
    },
  },
});

export const recurrencesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/recurrences": {
    get: {
      operationId: "listRecurrences",
      summary:
        "The space's recurrences in the order they were defined, with their status and next and last occurrences",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "Recurrences", content: jsonContent(RecurrenceListSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
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
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": {
    patch: {
      operationId: "updateRecurrence",
      summary:
        "Change a recurrence's description, amount, category, split, schedule, mode or end date for its occurrences not recorded yet",
      ...securedByUser,
      requestParams: { path: RecurrencePath },
      requestBody: { content: jsonContent(UpdateRecurrenceBodySchema) },
      responses: {
        "200": recurrenceResponse("The recurrence as changed"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, RecurrenceNotFound, ${TEMPLATE_404}`,
          "409": `RecurrenceEnded, ${TEMPLATE_409}, SpaceArchived`,
          "422": `ValidationFailed (including the template, type, payer, accounts or start date, which an edit cannot change), InvalidAmount, InvalidDate, InvalidDescription, InvalidPeriodPolicy, ${INVALID_EDIT}, CurrencyMismatch, UnknownCurrency, ${creatorRefusals422("changes", NOT_A_MEMBER_ON_EDIT)}`,
        }),
      },
    },
    get: {
      operationId: "getRecurrence",
      summary: "One recurrence with its status and its next and last occurrences",
      ...securedByUser,
      requestParams: { path: RecurrencePath },
      responses: {
        "200": recurrenceResponse("The recurrence"),
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, RecurrenceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/occurrences": {
    get: {
      operationId: "listUpcomingOccurrences",
      summary: "The next dates a recurrence will record (none while paused or ended)",
      ...securedByUser,
      requestParams: { path: RecurrencePath, query: UpcomingOccurrencesQuerySchema },
      responses: {
        "200": {
          description: "Upcoming dates, earliest first",
          content: jsonContent(UpcomingOccurrencesSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound, RecurrenceNotFound",
          "422": "ValidationFailed (count is not an integer from 1 to 24)",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/pause": recurrenceMove(
    "pauseRecurrence",
    "Pause an ACTIVE recurrence: nothing is recorded until it resumes",
  ),
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/resume": recurrenceMove(
    "resumeRecurrence",
    "Resume a PAUSED recurrence from today, never back-filling the days it was paused",
    {
      "403": CREATOR_403,
      "404": `SpaceNotFound, RecurrenceNotFound, ${TEMPLATE_404}`,
      "409": `InvalidRecurrenceTransition, ${TEMPLATE_409}, SpaceArchived`,
      "422": creatorRefusals422("resumes", LEFT_ON_RESUME),
    },
  ),
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/end": recurrenceMove(
    "endRecurrence",
    "End a recurrence: it and its occurrences stay, and nothing more is recorded",
  ),
  "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/extend": {
    post: {
      operationId: "extendRecurrence",
      summary:
        "Extend an ENDED recurrence with a new end date, or none: the same recurrence goes on from today, never back-filling the days it was ended",
      ...securedByUser,
      requestParams: { path: RecurrencePath },
      requestBody: { content: jsonContent(ExtendRecurrenceBodySchema) },
      responses: {
        "200": recurrenceResponse("The recurrence, ACTIVE again"),
        ...problems({
          "401": "Unauthenticated",
          "403": CREATOR_403,
          "404": `SpaceNotFound, RecurrenceNotFound, ${TEMPLATE_404}`,
          "409": `InvalidRecurrenceTransition (it is not ENDED), ${TEMPLATE_409}, SpaceArchived`,
          "422": `ValidationFailed (endDate is required), InvalidDate, InvalidRecurrence (an end date before the start; no schedule date from today, or from where it was due, through the end date), ${creatorRefusals422("extends", LEFT_ON_RESUME)}`,
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/pending-occurrences": {
    get: {
      operationId: "listPendingOccurrences",
      summary:
        "Occurrences of CONFIRM recurrences waiting for the real amount; listed for members who record money",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "Pending occurrences, earliest first",
          content: jsonContent(PendingOccurrenceListSchema),
        },
        ...problems({ "401": "Unauthenticated", "403": "InsufficientRole", "404": "SpaceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/skip": {
    post: {
      operationId: "skipOccurrence",
      summary: "Skip a pending occurrence: nothing is recorded and the recurrence goes on",
      ...securedByUser,
      requestParams: { path: OccurrencePath },
      responses: {
        "200": { description: "The occurrence, now SKIPPED", content: jsonContent(OccurrenceSchema) },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, OccurrenceNotFound",
          "409": "OccurrenceNotPending, SpaceArchived",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/confirm": {
    post: {
      operationId: "confirmOccurrence",
      summary: "Record a pending occurrence with the real amount, and optionally another day of its period",
      ...securedByUser,
      requestParams: { path: OccurrencePath, header: IdempotencyHeader },
      requestBody: { content: jsonContent(ConfirmOccurrenceBodySchema) },
      responses: {
        "201": {
          description: "The recorded transaction and its warnings; ETag carries its version",
          content: jsonContent(RecordedExpenseSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": `SpaceNotFound, OccurrenceNotFound, ${TEMPLATE_404}`,
          "409": `OccurrenceNotPending, PeriodClosed, ${TEMPLATE_409}, SpaceArchived, IdempotencyKeyConflict`,
          "422": `ValidationFailed, InvalidAmount, InvalidDate, InvalidOccurrenceDate, CurrencyMismatch, UnknownCurrency, InvalidIdempotencyKey, ${TEMPLATE_422}`,
        }),
      },
    },
  },
};
