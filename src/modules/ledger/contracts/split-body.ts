import { z } from "zod";
import { basisPointsOf, IdSchema, PercentSchema } from "@/shared/http/contracts";
import type { RecurrenceSplit } from "../application";

/** Payers and participants per expense or recurrence: bounds the payload; membership is checked by the domain. */
export const MAX_PARTS = 100;

/**
 * The split bodies an expense and a recurrence share: EQUAL among the chosen members, or by percentage or share units
 * per member. An expense also takes EXACT amounts (`SplitBodySchema`); a recurrence does not (ruling P23).
 */
export const EqualSplitSchema = z.object({
  method: z.literal("EQUAL"),
  participants: z.array(z.object({ memberId: IdSchema })).max(MAX_PARTS),
});
export const PercentSplitSchema = z.object({
  method: z.literal("PERCENT"),
  participants: z.array(z.object({ memberId: IdSchema, percent: PercentSchema })).max(MAX_PARTS),
});
export const SharesSplitSchema = z.object({
  method: z.literal("SHARES"),
  participants: z.array(z.object({ memberId: IdSchema, units: z.number().int() })).max(MAX_PARTS),
});

export type SharedSplitBody =
  z.infer<typeof EqualSplitSchema> | z.infer<typeof PercentSplitSchema> | z.infer<typeof SharesSplitSchema>;

/** The split as the use cases take it: percentages become basis points. Every method here maps without failing. */
export const splitOf = (split: SharedSplitBody): RecurrenceSplit => {
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
