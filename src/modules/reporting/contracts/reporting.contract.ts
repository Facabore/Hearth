import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { FUNDINGS, PLAN_STATUSES } from "@/modules/budgeting/application";
import {
  jsonContent,
  moneyOf,
  MoneySchema,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import type { LineDashboard, ReportPlan, UnbudgetedSpending } from "../application";

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
};
