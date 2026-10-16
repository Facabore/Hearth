import { z } from "zod";
import { basisPointsOf, moneyFromDto, MoneySchema, PercentSchema } from "@/shared/http/contracts";
import { localDate, ok, type Result } from "@/shared/kernel";
import type { DefineRecurrenceInput, RecurrenceSplit, TemplateInput } from "../application";

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
