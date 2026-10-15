import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  jsonContent,
  moneyFromDto,
  MoneySchema,
  percentOf,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
  type MoneyDto,
} from "@/shared/http/contracts";
import type { HttpSuccess } from "@/shared/http/define-route";
import { etagOf } from "@/shared/http/etag";
import { ok, type Money, type Result } from "@/shared/kernel";
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

/** HU-E6-01: the period's label in the space policy, e.g. "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
export const CreatePlanBodySchema = z.object({ period: z.string().max(20) });

const Id = z.string().min(1).max(64);
/** Members per request: bounds the payload; membership is checked by the domain. */
const MAX_MEMBERS = 100;

/** HU-E6-02: the listed members' capacities; members not listed keep theirs. */
export const SetCapacitiesBodySchema = z.object({
  capacities: z
    .array(z.object({ memberId: Id, amount: MoneySchema }))
    .min(1)
    .max(MAX_MEMBERS),
});

/** HU-E6-02: the capacities as the use case takes them; fails only for currencies the kernel does not know. */
export const capacitiesFromBody = (
  body: z.infer<typeof SetCapacitiesBodySchema>,
): Result<{ memberId: string; amount: Money }[]> => {
  const capacities: { memberId: string; amount: Money }[] = [];
  for (const entry of body.capacities) {
    const amount = moneyFromDto(entry.amount);
    if (!amount.ok) return amount;
    capacities.push({ memberId: entry.memberId, amount: amount.value });
  }
  return ok(capacities);
};

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

const SpacePath = z.object({ spaceId: z.string() });
const PlanPath = SpacePath.extend({ planId: z.string() });
const planResponse = (description: string) => ({ description, content: jsonContent(BudgetPlanSchema) });

const IfMatchHeader = z.object({ "if-match": z.string().optional() });

/** A write to a plan (HU-E6-02 … HU-E6-05): If-Match is optional, and the answer is the plan with its new ETag. */
const planWrite = <P extends z.ZodObject>(
  operationId: string,
  summary: string,
  path: P,
  body: z.ZodType | null,
  errors: Record<string, string>,
  status: "200" | "201" = "200",
) => ({
  operationId,
  summary,
  ...securedByUser,
  requestParams: { path, header: IfMatchHeader },
  ...(body === null ? {} : { requestBody: { content: jsonContent(body) } }),
  responses: {
    [status]: planResponse("The plan with its new ETag"),
    ...problems({
      "401": "Unauthenticated",
      "403": "InsufficientRole",
      "412": "PreconditionFailed",
      ...errors,
    }),
  },
});

export const budgetingPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/plans": {
    post: {
      operationId: "createBudgetPlan",
      summary: "Create a DRAFT plan for a period of the space's policy; its boundaries are stored (D10)",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreatePlanBodySchema) },
      responses: {
        "201": planResponse("The new plan; ETag carries its version, Location its URL"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "PlanAlreadyExists, SpaceArchived",
          "422": "ValidationFailed, InvalidPeriodLabel",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}": {
    get: {
      operationId: "getBudgetPlan",
      summary:
        "A plan with its capacities, lines and every figure computed on read; ETag carries its version",
      ...securedByUser,
      requestParams: { path: PlanPath },
      responses: {
        "200": planResponse("The plan"),
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, BudgetPlanNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/capacities": {
    put: planWrite(
      "setMemberCapacities",
      "Set the listed members' capacities; the others keep theirs, and a MEMBER may set only their own (D17)",
      PlanPath,
      SetCapacitiesBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409": "SpaceArchived",
        "422": "ValidationFailed, InvalidCapacity, NotASpaceMember, CurrencyMismatch, UnknownCurrency",
      },
    ),
  },
};
