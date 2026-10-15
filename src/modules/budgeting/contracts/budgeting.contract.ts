import { z } from "zod";
import { MoneySchema, percentOf, PeriodSchema, periodDto, type MoneyDto } from "@/shared/http/contracts";
import type { HttpSuccess } from "@/shared/http/define-route";
import { etagOf } from "@/shared/http/etag";
import {
  ALLOCATION_RULES,
  FUNDINGS,
  PLAN_STATUSES,
  ROLLOVER_MODES,
  type BudgetPlanView,
  type LineFigure,
} from "../application";

const moneyOf = (minor: bigint, currency: string): MoneyDto => ({ amount: minor.toString(), currency });
const percentOrNull = (basisPoints: number | null): string | null =>
  basisPoints === null ? null : percentOf(basisPoints);

export const BudgetLineSchema = z.object({
  id: z.string(),
  name: z.string(),
  plannedAmount: MoneySchema,
  funding: z.enum(FUNDINGS),
  rolloverMode: z.enum(ROLLOVER_MODES),
  isCatchAll: z.boolean(),
  /** SAVINGS lines: the accounts whose incoming transfers are the line's spending (spec 5.4). */
  savingsAccountIds: z.array(z.string()),
  /** HU-E6-04: the categories mapped to the line; the catch-all line also consumes every unmapped one. */
  categoryIds: z.array(z.string()),
  /** HU-E6-03: the planned amount as a percentage of total capacity, two decimals ("36.75"); null without capacity. */
  capacityShare: z.string().nullable(),
  allocation: z.object({
    rule: z.enum(ALLOCATION_RULES),
    /** Every current member in join order; empty for NONE, group money without per-member responsibility. */
    members: z.array(
      z.object({
        memberId: z.string(),
        /** PERCENT lines: the member's percentage, two decimals. */
        percent: z.string().nullable(),
        /** FIXED lines: the member's fixed amount. */
        amount: MoneySchema.nullable(),
        /** Derived on read; null while the allocation is invalid. */
        assigned: MoneySchema.nullable(),
      }),
    ),
    /** HU-E6-05: InvalidAllocation while the values do not add up or there is no capacity to follow. */
    error: z.enum(["InvalidAllocation"]).nullable(),
  }),
  /** Spec 5.4: spent in the plan's period, computed on read (D7). */
  spent: MoneySchema,
  /** planned + carry-over − spent; the carry-over is 0 until lines are copied (HU-E6-06, HU-E6-09). */
  available: MoneySchema,
});

export const BudgetPlanSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  /**
   * The period stored when the plan was created (D10). A copy of PeriodSchema: zod-openapi renders a registered
   * component in both directions, so referencing the registered Period here would split it into Period/PeriodOutput.
   */
  period: PeriodSchema.extend({}),
  status: z.enum(PLAN_STATUSES),
  /** HU-E6-06: the plan this one was copied from. */
  createdFrom: z.string().nullable(),
  /** Same value as the ETag; send it back in If-Match. */
  version: z.number().int(),
  /** Every current member in join order, guests included (D15); 0 until set (HU-E6-02). */
  capacities: z.array(z.object({ memberId: z.string(), amount: MoneySchema, share: z.string().nullable() })),
  totalCapacity: MoneySchema,
  planned: MoneySchema,
  /** Total capacity − Σ planned; negative once capacities were reduced below the lines (HU-E6-02). */
  unallocated: MoneySchema,
  lines: z.array(BudgetLineSchema),
  /** HU-E6-04: unmapped spending when the plan has no catch-all line; null when it has one. */
  unbudgeted: z.object({ spent: MoneySchema, available: MoneySchema }).nullable(),
});

const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {
  const { line, allocation } = figure;
  return {
    id: line.id,
    name: line.name,
    plannedAmount: moneyOf(line.plannedAmount, currency),
    funding: line.funding,
    rolloverMode: line.rolloverMode,
    isCatchAll: line.isCatchAll,
    savingsAccountIds: [...line.savingsAccountIds],
    categoryIds: [...figure.categoryIds],
    capacityShare: percentOrNull(figure.capacityShareBasisPoints),
    allocation: {
      rule: allocation.rule,
      members: allocation.members.map((m) => ({
        memberId: m.memberId,
        percent: allocation.rule === "PERCENT" && m.value !== null ? percentOf(Number(m.value)) : null,
        amount: allocation.rule === "FIXED" && m.value !== null ? moneyOf(m.value, currency) : null,
        assigned: m.assigned === null ? null : moneyOf(m.assigned, currency),
      })),
      error: allocation.invalid ? "InvalidAllocation" : null,
    },
    spent: moneyOf(figure.spent, currency),
    available: moneyOf(figure.available, currency),
  };
};

export const budgetPlanDto = ({
  plan,
  currency,
  figures,
}: BudgetPlanView): z.infer<typeof BudgetPlanSchema> => ({
  id: plan.id,
  spaceId: plan.spaceId,
  period: periodDto(plan.period),
  status: plan.status,
  createdFrom: plan.createdFrom,
  version: plan.version,
  capacities: figures.capacities.map((c) => ({
    memberId: c.memberId,
    amount: moneyOf(c.amount, currency),
    share: percentOrNull(c.shareBasisPoints),
  })),
  totalCapacity: moneyOf(figures.totalCapacity, currency),
  planned: moneyOf(figures.planned, currency),
  unallocated: moneyOf(figures.unallocated, currency),
  lines: figures.lines.map((figure) => lineDto(figure, currency)),
  unbudgeted:
    figures.unbudgeted === null
      ? null
      : {
          spent: moneyOf(figures.unbudgeted.spent, currency),
          available: moneyOf(figures.unbudgeted.available, currency),
        },
});

/** Every plan response carries the plan's version as its ETag (spec 7, HU-E0-10). */
export const planSuccess = (view: BudgetPlanView, status = 200): HttpSuccess => ({
  status,
  body: budgetPlanDto(view),
  headers: [["etag", etagOf(view.plan.version)]],
});

/** HU-E6-01: 201 with the new plan, its ETag and its location. */
export const planCreated = (view: BudgetPlanView): HttpSuccess => ({
  status: 201,
  body: budgetPlanDto(view),
  headers: [
    ["etag", etagOf(view.plan.version)],
    ["location", `/api/v1/spaces/${view.plan.spaceId}/plans/${view.plan.id}`],
  ],
});
