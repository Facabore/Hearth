import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { ALLOCATION_RULES, FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";
import {
  jsonContent,
  type MoneyDto,
  moneyOf,
  MoneySchema,
  percentOf,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import {
  GAP_STATUSES,
  MATRIX_REASONS,
  type FundContributionReport,
  CHANGE_STATUSES,
  type Change,
  type LineTrend,
  type PersonalTrend,
  type LineDashboard,
  type MemberLineMatrix,
  type ReportPlan,
  type UnbudgetedSpending,
  type UnifiedPersonalView,
} from "../application";

/** HU-E7-01 … HU-E7-03: the period's label in the space policy, "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
export const ReportQuerySchema = z.object({ period: z.string().min(1).max(32) });

/** The plan the report reads, whatever its status; null when the period has no plan (ruling P33). */
const ReportPlanSchema = z.object({ id: z.string(), status: z.enum(PLAN_STATUSES) }).nullable();

const reportPlanDto = (plan: ReportPlan | null): z.infer<typeof ReportPlanSchema> =>
  plan === null ? null : { id: plan.id, status: plan.status };

/** HU-E7-01: each line as the plan derives it (spec 5.4, D7). */
export const LineDashboardSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  /** The plan's lines in plan order; empty without a plan. */
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      funding: z.enum(FUNDINGS),
      isCatchAll: z.boolean(),
      planned: MoneySchema,
      spent: MoneySchema,
      /** HU-E6-09: carried from the line this one was copied from, by its rollover mode. */
      carryOver: MoneySchema,
      /** planned + carry-over − spent. */
      available: MoneySchema,
      /** The available amount is negative. */
      overspent: z.boolean(),
    }),
  ),
  /** What no line consumes, every expense without a plan; null when the plan has a catch-all line (ruling P34). */
  unbudgeted: z.object({ spent: MoneySchema, available: MoneySchema, overspent: z.boolean() }).nullable(),
});

const unbudgetedDto = (unbudgeted: UnbudgetedSpending | null, currency: string) =>
  unbudgeted === null
    ? null
    : {
        spent: moneyOf(unbudgeted.spent, currency),
        available: moneyOf(unbudgeted.available, currency),
        overspent: unbudgeted.overspent,
      };

export const lineDashboardDto = (dashboard: LineDashboard): z.infer<typeof LineDashboardSchema> => ({
  spaceId: dashboard.spaceId,
  period: periodDto(dashboard.period),
  plan: reportPlanDto(dashboard.plan),
  lines: dashboard.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    funding: line.funding,
    isCatchAll: line.isCatchAll,
    planned: moneyOf(line.planned, dashboard.currency),
    spent: moneyOf(line.spent, dashboard.currency),
    carryOver: moneyOf(line.carryOver, dashboard.currency),
    available: moneyOf(line.available, dashboard.currency),
    overspent: line.overspent,
  })),
  unbudgeted: unbudgetedDto(dashboard.unbudgeted, dashboard.currency),
});

/** HU-E7-02: every line of the period's plan with every current member's figures (spec 5.4, ruling P35). */
export const MemberMatrixSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      funding: z.enum(FUNDINGS),
      rule: z.enum(ALLOCATION_RULES),
      /** Why figures are null: NONE lines report consumption only, SHARED_FUND lines leave contribution to the fund. */
      reason: z.enum(MATRIX_REASONS).nullable(),
      /** Every current member in join order, guests included. */
      members: z.array(
        z.object({
          memberId: z.string(),
          assigned: MoneySchema.nullable(),
          contributed: MoneySchema.nullable(),
          /** Null on SAVINGS lines. */
          consumed: MoneySchema.nullable(),
          /** contributed − assigned; positive means the member over-contributed. */
          gap: MoneySchema.nullable(),
          status: z.enum(GAP_STATUSES).nullable(),
        }),
      ),
    }),
  ),
});

const moneyOrNull = (minor: bigint | null, currency: string): MoneyDto | null =>
  minor === null ? null : moneyOf(minor, currency);

export const memberMatrixDto = (matrix: MemberLineMatrix): z.infer<typeof MemberMatrixSchema> => ({
  spaceId: matrix.spaceId,
  period: periodDto(matrix.period),
  plan: reportPlanDto(matrix.plan),
  lines: matrix.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    funding: line.funding,
    rule: line.rule,
    reason: line.reason,
    members: line.members.map((cell) => ({
      memberId: cell.memberId,
      assigned: moneyOrNull(cell.assigned, matrix.currency),
      contributed: moneyOrNull(cell.contributed, matrix.currency),
      consumed: moneyOrNull(cell.consumed, matrix.currency),
      gap: moneyOrNull(cell.gap, matrix.currency),
      status: cell.status,
    })),
  })),
});

/** HU-E7-03: each current member's expected and actual contributions to the shared fund (spec 5.4, ruling P36). */
export const FundContributionsSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  plan: ReportPlanSchema,
  /** Every current member in join order, guests included. */
  members: z.array(
    z.object({
      memberId: z.string(),
      /** Σ the member's assigned amounts on the plan's SHARED_FUND lines; 0 without a plan. */
      expected: MoneySchema,
      /** Σ the member's fund contributions dated in the period. */
      actual: MoneySchema,
      /** actual − expected; negative while the member still has to pay in. */
      difference: MoneySchema,
    }),
  ),
});

export const fundContributionsDto = (
  report: FundContributionReport,
): z.infer<typeof FundContributionsSchema> => ({
  spaceId: report.spaceId,
  period: periodDto(report.period),
  plan: reportPlanDto(report.plan),
  members: report.members.map((m) => ({
    memberId: m.memberId,
    expected: moneyOf(m.expected, report.currency),
    actual: moneyOf(m.actual, report.currency),
    difference: moneyOf(m.difference, report.currency),
  })),
});

/** HU-E7-04: the caller's consumption and cash out in their personal period (spec 5.4, D11, ruling P37). */
export const UnifiedViewSchema = z.object({
  /** The personal space's currency, every amount's (D6). */
  currency: z.string(),
  /** The caller's personal-space period; shared transactions are placed in it by date. */
  period: PeriodSchema,
  consumption: z.object({
    total: MoneySchema,
    /** The largest first: a catalog `key` groups seeded categories of every space; a custom one comes with its space. */
    categories: z.array(
      z.object({
        key: z.string().nullable(),
        /** A merged group's name in the caller's personal space, else in the space spending most in it. */
        name: z.string(),
        space: z.object({ id: z.string(), name: z.string() }).nullable(),
        category: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
        amount: MoneySchema,
      }),
    ),
  }),
  /** payments + fund contributions + savings transfers (spec 5.4); settlements are not cash out. */
  cashOut: z.object({
    total: MoneySchema,
    payments: MoneySchema,
    fundContributions: MoneySchema,
    savingsTransfers: MoneySchema,
    /** The part paid without an account, while the caller was a guest. */
    outsideTheApp: MoneySchema,
  }),
  /** Spaces in another currency, left out of every amount. */
  otherCurrencySpaces: z.array(z.object({ spaceId: z.string(), name: z.string(), currency: z.string() })),
});

export const unifiedViewDto = (view: UnifiedPersonalView): z.infer<typeof UnifiedViewSchema> => {
  const money = (minor: bigint) => moneyOf(minor, view.currency);
  return {
    currency: view.currency,
    period: periodDto(view.period),
    consumption: {
      total: money(view.consumption.total),
      categories: view.consumption.groups.map((g) => ({
        key: g.key,
        name: g.name,
        space: g.space,
        category: g.category,
        amount: money(g.amount),
      })),
    },
    cashOut: {
      total: money(view.cashOut.total),
      payments: money(view.cashOut.payments),
      fundContributions: money(view.cashOut.fundContributions),
      savingsTransfers: money(view.cashOut.savingsTransfers),
      outsideTheApp: money(view.cashOut.outsideTheApp),
    },
    otherCurrencySpaces: view.otherCurrencySpaces.map((s) => ({ ...s })),
  };
};

/** HU-E7-05: the end period's label and how many periods to show, 6 by default (ruling P38). */
export const TrendQuerySchema = z.object({
  endPeriod: z.string().min(1).max(32),
  periods: z.coerce.number().int().min(1).max(24).default(6),
});

/**
 * −370 basis points → "-3.70": signed, exactly two decimals. Null where there is no percentage: a NEW change, or one
 * past Number.MAX_SAFE_INTEGER basis points (about 90 trillion percent, e.g. 1 minor unit to 9e11), which cannot be
 * written exactly; the change amount and status are still answered (ruling P100).
 */
export const signedPercent = (basisPoints: number | null): string | null =>
  basisPoints === null || !Number.isSafeInteger(basisPoints)
    ? null
    : `${basisPoints < 0 ? "-" : ""}${percentOf(Math.abs(basisPoints))}`;

export const changeDto = (change: Change | null, currency: string) => ({
  change: change === null || change.amount === null ? null : moneyOf(change.amount, currency),
  changePercent: signedPercent(change?.basisPoints ?? null),
});

/** A change as a signed percentage: `-3.70`, exactly two decimals (see `signedPercent`). */
const ChangePercentSchema = z
  .string()
  .regex(/^-?\d+\.\d{2}$/)
  .nullable()
  .describe(
    "Signed percentage with two decimals, e.g. -3.70, rounded half away from zero; null when changeStatus is NEW or null, or when the change exceeds 2^53 basis points (change and status are still answered).",
  );

/** HU-E7-05: each line of the end period's plan over the window, versus the previous period of the policy. */
export const LineTrendSchema = z.object({
  spaceId: z.string(),
  /** The window, oldest first, ending with `endPeriod`. */
  periods: z.array(PeriodSchema),
  plan: ReportPlanSchema,
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      /** One per period, in the order of `periods`. */
      points: z.array(
        z.object({
          /** The period's label. */
          period: z.string(),
          /** Null where the line has no figure (no plan, or no line it continues). */
          spent: MoneySchema.nullable(),
          change: MoneySchema.nullable().describe(
            "Current minus previous; null when changeStatus is NEW or null.",
          ),
          changePercent: ChangePercentSchema,
          changeStatus: z
            .enum(CHANGE_STATUSES)
            .nullable()
            .describe("NEW without a previous figure or when it was 0; null where spent is null."),
        }),
      ),
    }),
  ),
});

export const lineTrendDto = (trend: LineTrend): z.infer<typeof LineTrendSchema> => ({
  spaceId: trend.spaceId,
  periods: trend.periods.map(periodDto),
  plan: reportPlanDto(trend.plan),
  lines: trend.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    points: line.points.map((p) => ({
      period: p.period.label,
      spent: p.spent === null ? null : moneyOf(p.spent, trend.currency),
      ...changeDto(p.change, trend.currency),
      changeStatus: p.change?.status ?? null,
    })),
  })),
});

/** HU-E7-05: the caller's consumption per personal period (HU-E7-04), each versus the period before. */
export const PersonalTrendSchema = z.object({
  /** The personal space's currency. */
  currency: z.string(),
  /** The caller's personal periods, oldest first, ending with `endPeriod`. */
  periods: z.array(PeriodSchema),
  /** One per period, in the order of `periods`. */
  points: z.array(
    z.object({
      period: z.string(),
      consumption: MoneySchema,
      change: MoneySchema.nullable().describe("Current minus previous; null when changeStatus is NEW."),
      changePercent: ChangePercentSchema,
      changeStatus: z.enum(CHANGE_STATUSES),
    }),
  ),
});

export const personalTrendDto = (trend: PersonalTrend): z.infer<typeof PersonalTrendSchema> => ({
  currency: trend.currency,
  periods: trend.periods.map(periodDto),
  points: trend.points.map((p) => ({
    period: p.period.label,
    consumption: moneyOf(p.consumption, trend.currency),
    ...changeDto(p.change, trend.currency),
    changeStatus: p.change.status,
  })),
});

const SpacePath = z.object({ spaceId: z.string() });
const reportProblems = problems({
  "401": "Unauthenticated",
  "404": "SpaceNotFound",
  "422": "ValidationFailed, InvalidPeriodLabel",
});

export const reportingPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/reports/lines": {
    get: {
      operationId: "getLineDashboard",
      summary: "Planned, spent and available per budget line for a period; computed on read",
      description:
        "Every member reads it, archived spaces included. The period's plan is reported whatever its status; without one, `plan` is null and every expense is under `unbudgeted`.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The lines of the period's plan in plan order, and what no line consumes",
          content: jsonContent(LineDashboardSchema),
        },
        ...reportProblems,
      },
    },
  },
  "/api/v1/spaces/{spaceId}/reports/member-matrix": {
    get: {
      operationId: "getMemberLineMatrix",
      summary:
        "Assigned, contributed, consumed and gap per member and budget line for a period; computed on read",
      description:
        "Every member reads it, viewers and archived spaces included. Reasons (NOT_ALLOCATED, TRACKED_AT_FUND_LEVEL, INVALID_ALLOCATION) and statuses (OVER_CONTRIBUTED, UNDER_CONTRIBUTED, ON_TARGET) are codes.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The lines of the period's plan, each with every current member in join order",
          content: jsonContent(MemberMatrixSchema),
        },
        ...reportProblems,
      },
    },
  },
  "/api/v1/spaces/{spaceId}/reports/fund-contributions": {
    get: {
      operationId: "getFundContributions",
      summary:
        "Expected versus actual contributions to the shared fund per member for a period; computed on read",
      description:
        "Every member reads it, archived spaces included. Expected comes from the plan's SHARED_FUND lines (0 without a plan); actual counts fund contributions dated in the period.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "Every current member in join order",
          content: jsonContent(FundContributionsSchema),
        },
        ...reportProblems,
      },
    },
  },
  "/api/v1/me/unified-view": {
    get: {
      operationId: "getUnifiedPersonalView",
      summary:
        "The caller's consumption and cash out in a personal period, across every space they are or were in",
      description:
        "Only the caller's own member rows are read, a claimed guest place's history included; other members' personal spaces never appear. Shared transactions are placed by date into the caller's personal period; categories group by catalog key, a subcategory under its parent category, and a merged group takes the name the caller's personal space gives its key.",
      ...securedByUser,
      requestParams: { query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The caller's consumption by category and cash out, in the personal space's currency",
          content: jsonContent(UnifiedViewSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/reports/trend": {
    get: {
      operationId: "getLineTrend",
      summary:
        "Spent per budget line over a window of periods, each versus the previous period of the space policy",
      description:
        "Follows the lines of the end period's plan back by their origin link, else their name. Percentages are signed with two decimals; without a previous figure, or when it was 0, the status is NEW and the change and percentage are null.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: TrendQuerySchema },
      responses: {
        "200": {
          description: "The window, oldest first, and every line of the end period's plan",
          content: jsonContent(LineTrendSchema),
        },
        ...reportProblems,
      },
    },
  },
  "/api/v1/me/trend": {
    get: {
      operationId: "getPersonalTrend",
      summary: "The caller's consumption per personal period over a window, each versus the period before",
      description:
        "Consumption as the unified view totals it, from the caller's own member rows only. Percentages are signed with two decimals; after a period without consumption the status is NEW.",
      ...securedByUser,
      requestParams: { query: TrendQuerySchema },
      responses: {
        "200": {
          description: "The caller's personal periods, oldest first, with their consumption",
          content: jsonContent(PersonalTrendSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
};
