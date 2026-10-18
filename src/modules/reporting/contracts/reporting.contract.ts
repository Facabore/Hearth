import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { ALLOCATION_RULES, FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";
import {
  jsonContent,
  type MoneyDto,
  moneyOf,
  MoneySchema,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import {
  GAP_STATUSES,
  MATRIX_REASONS,
  type FundContributionReport,
  type LineDashboard,
  type MemberLineMatrix,
  type ReportPlan,
  type UnbudgetedSpending,
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
};
