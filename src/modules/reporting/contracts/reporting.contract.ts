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
  type CashFlowDays,
  type CashFlowView,
  type CategorySpending,
  type SpendingByGroup,
  type SubcategorySpending,
  type PersonalSpendingByGroup,
  type LineDashboard,
  type MemberLineMatrix,
  type ReportPlan,
  type UnbudgetedSpending,
  type UnifiedPersonalView,
} from "../application";

/** HU-E7-01 … HU-E7-03: the period's label in the space policy, "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
export const ReportQuerySchema = z.object({ period: z.string().min(1).max(32) });

/** The plan the report reads, whatever its status (ruling P33). */
const ReportPlanSchema = z
  .object({ id: z.string(), status: z.enum(PLAN_STATUSES) })
  .nullable()
  .describe("The plan the report reads, whatever its status; null when no plan has the period.");

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
      state: z
        .enum(["OK", "NEAR", "HIGH", "OVER"])
        .describe(
          "Of planned + carry-over: NEAR from 80 % used, HIGH above 90 %, OVER below 0 left; a SAVINGS line is always OK.",
        ),
      overBy: MoneySchema.nullable().describe(
        "How much an OVER line went past its budget, positive; null otherwise.",
      ),
    }),
  ),
  unbudgeted: z
    .object({ spent: MoneySchema, available: MoneySchema, overspent: z.boolean() })
    .nullable()
    .describe(
      "What no line consumes, every expense when the period has no plan; null when the plan has a catch-all line.",
    ),
  totals: z
    .object({ planned: MoneySchema, spent: MoneySchema, available: MoneySchema })
    .describe(
      "Σ of the lines' figures plus Unbudgeted's spent and available; planned counts the lines only.",
    ),
  categoryLines: z
    .array(z.object({ categoryId: z.string(), lineId: z.string().nullable() }))
    .describe(
      "Every live category of the space with the line its expenses consume in the plan: its mapped line, its parent's line for a subcategory, else the catch-all line; null for Unbudgeted. Empty without a plan.",
    ),
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
    state: line.state,
    overBy: line.overBy === null ? null : moneyOf(line.overBy, dashboard.currency),
  })),
  unbudgeted: unbudgetedDto(dashboard.unbudgeted, dashboard.currency),
  totals: {
    planned: moneyOf(dashboard.totals.planned, dashboard.currency),
    spent: moneyOf(dashboard.totals.spent, dashboard.currency),
    available: moneyOf(dashboard.totals.available, dashboard.currency),
  },
  categoryLines: dashboard.categoryLines.map((c) => ({ categoryId: c.categoryId, lineId: c.lineId })),
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
      reason: z
        .enum(MATRIX_REASONS)
        .nullable()
        .describe(
          "Why some member figures are null: NOT_ALLOCATED (rule NONE) reports consumption only, TRACKED_AT_FUND_LEVEL (SHARED_FUND) leaves contribution and gap to the fund, INVALID_ALLOCATION assigns nobody; null when the line is allocated, valid and tracked per member.",
        ),
      /** Every current member in join order, guests included. */
      members: z.array(
        z.object({
          memberId: z.string(),
          assigned: MoneySchema.nullable().describe(
            "Null when the line is not allocated (rule NONE), its allocation is invalid, or the allocation names no amount for the member.",
          ),
          contributed: MoneySchema.nullable().describe(
            "Null when reason is NOT_ALLOCATED or TRACKED_AT_FUND_LEVEL.",
          ),
          consumed: MoneySchema.nullable().describe(
            "Null on SAVINGS lines, whose spending is transfers, not shares.",
          ),
          gap: MoneySchema.nullable().describe(
            "contributed − assigned; positive means the member over-contributed. Null when reason is not null or assigned is null.",
          ),
          status: z.enum(GAP_STATUSES).nullable().describe("The sign of gap; null when gap is null."),
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
  totals: z
    .object({ expected: MoneySchema, actual: MoneySchema, difference: MoneySchema })
    .describe("Σ over the listed members of expected, actual and difference."),
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
  totals: {
    expected: moneyOf(report.totals.expected, report.currency),
    actual: moneyOf(report.totals.actual, report.currency),
    difference: moneyOf(report.totals.difference, report.currency),
  },
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
        key: z
          .string()
          .nullable()
          .describe("The catalog key of a seeded category (HU-E3-05); null for a category users create."),
        /** A merged group's name in the caller's personal space, else in the space spending most in it. */
        name: z.string(),
        space: z
          .object({ id: z.string(), name: z.string() })
          .nullable()
          .describe("The space of a custom category; null for a row merged by catalog key."),
        category: z
          .object({ id: z.string(), name: z.string() })
          .nullable()
          .describe("The custom category, named as the row; null for a row merged by catalog key."),
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

/** #150, ruling P241 (M6c): the calendar's window, 30 days unless 60 is asked for. */
export const CashFlowQuerySchema = z.object({
  days: z
    .enum(["30", "60"])
    .default("30")
    .transform((days) => Number(days) as CashFlowDays),
});

const CashFlowMovementSchema = z.object({
  recurrenceId: z.string(),
  occurrenceId: z.string().nullable(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"]),
  description: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  dueDate: z
    .string()
    .describe("When it was due; a PENDING occurrence or an unreached earlier date is listed on today."),
  status: z.enum(["SCHEDULED", "PENDING"]),
  estimated: z.boolean().describe("A CONFIRM recurrence's estimate, which a member confirms or changes."),
  amount: MoneySchema,
  effect: MoneySchema.describe(
    "The signed change of the caller's available money: + into a counted account, − out of one, 0 between two or none.",
  ),
});

export const CashFlowSchema = z.object({
  currency: z.string(),
  from: z.string(),
  through: z.string(),
  days: z.union([z.literal(30), z.literal(60)]),
  opening: MoneySchema.describe("Today's available money of the caller's personal space."),
  dates: z.array(
    z.object({ date: z.string(), movements: z.array(CashFlowMovementSchema), balanceAfter: MoneySchema }),
  ),
  totals: z.object({ incoming: MoneySchema, outgoing: MoneySchema, closing: MoneySchema }),
  lowest: z.object({ date: z.string(), balance: MoneySchema }),
  otherCurrencySpaces: z.array(z.object({ spaceId: z.string(), name: z.string(), currency: z.string() })),
});

export const cashFlowDto = (view: CashFlowView): z.infer<typeof CashFlowSchema> => {
  const money = (minor: bigint) => moneyOf(minor, view.currency);
  return {
    currency: view.currency,
    from: view.from,
    through: view.through,
    days: view.days,
    opening: money(view.opening),
    dates: view.dates.map((d) => ({
      date: d.date,
      movements: d.movements.map((m) => ({
        recurrenceId: m.recurrenceId,
        occurrenceId: m.occurrenceId,
        type: m.type,
        description: m.description,
        space: m.space,
        dueDate: m.date,
        status: m.status,
        estimated: m.estimated,
        amount: money(m.amount),
        effect: money(m.effect),
      })),
      balanceAfter: money(d.balanceAfter),
    })),
    totals: {
      incoming: money(view.totals.incoming),
      outgoing: money(view.totals.outgoing),
      closing: money(view.totals.closing),
    },
    lowest: { date: view.lowest.date, balance: money(view.lowest.balance) },
    otherCurrencySpaces: [...view.otherCurrencySpaces],
  };
};

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
  plan: ReportPlanSchema.describe(
    "The end period's plan, whose lines the trend follows; null when it has none, and then lines is empty.",
  ),
  lines: z.array(
    z.object({
      lineId: z.string(),
      name: z.string(),
      /** One per period, in the order of `periods`. */
      points: z.array(
        z.object({
          /** The period's label, unique within the window (#132). */
          period: z
            .string()
            .describe(
              "The period's label, unique within the window and equal to the label of periods[i]: a derived period that shares its label with a stored one is written '<label> (<start>..<end>)'.",
            ),
          spent: MoneySchema.nullable().describe(
            "Null where the line has no figure: the period has no plan, or no line of it continues this one.",
          ),
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
      period: z
        .string()
        .describe(
          "The period's label, unique within the window and equal to the label of periods[i]: a derived period that shares its label with a stored one is written '<label> (<start>..<end>)'.",
        ),
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

/** HU-E7-06: what every group and category of a breakdown carries. */
const spendingNode = {
  /** Null only for a personal row merged by catalog key; a space's own breakdown always has it. */
  id: z
    .string()
    .nullable()
    .describe("Null only for a personal row merged by catalog key; never null in a space's own breakdown"),
  /** The catalog key of a seeded group or category (HU-E3-05, D11); null for those users create. */
  key: z
    .string()
    .nullable()
    .describe("The catalog key of a seeded group or category (HU-E3-05); null for those users create"),
  name: z.string(),
  /** Archived nodes still appear while they have spending in the period (HU-E3-03). */
  archived: z.boolean(),
  total: MoneySchema,
  /** Percent of the parent's total with two decimals, each level rounded half up on its own ("56.94"). */
  share: z.string(),
};

/** HU-E7-06: one subcategory, or (`subcategoryId` and `name` null) what was spent in the category itself. */
const SubcategorySpendingSchema = z.object({
  subcategoryId: z
    .string()
    .nullable()
    .describe("Null only for the entry of what was spent in the category itself, not in a subcategory"),
  name: z
    .string()
    .nullable()
    .describe("Null only for the entry of what was spent in the category itself, not in a subcategory"),
  archived: z.boolean(),
  total: MoneySchema,
  share: z.string(),
});

/** HU-E7-06: a space's spending in a period by group, category and subcategory, every level largest first. */
export const SpendingByGroupSchema = z.object({
  spaceId: z.string(),
  period: PeriodSchema,
  total: MoneySchema,
  groups: z.array(
    z.object({
      ...spendingNode,
      categories: z.array(z.object({ ...spendingNode, subcategories: z.array(SubcategorySpendingSchema) })),
    }),
  ),
});

type SpendingNodeOf = Pick<CategorySpending, "id" | "key" | "name" | "archived" | "total" | "share">;

const spendingNodeDto = (node: SpendingNodeOf, currency: string) => ({
  id: node.id,
  key: node.key,
  name: node.name,
  archived: node.archived,
  total: moneyOf(node.total, currency),
  share: percentOf(node.share),
});

const subcategorySpendingDto = (entry: SubcategorySpending, currency: string) => ({
  subcategoryId: entry.subcategoryId,
  name: entry.name,
  archived: entry.archived,
  total: moneyOf(entry.total, currency),
  share: percentOf(entry.share),
});

export const spendingByGroupDto = (report: SpendingByGroup): z.infer<typeof SpendingByGroupSchema> => ({
  spaceId: report.spaceId,
  period: periodDto(report.period),
  total: moneyOf(report.total, report.currency),
  groups: report.groups.map((group) => ({
    ...spendingNodeDto(group, report.currency),
    categories: group.categories.map((category) => ({
      ...spendingNodeDto(category, report.currency),
      subcategories: category.subcategories.map((entry) => subcategorySpendingDto(entry, report.currency)),
    })),
  })),
});

/** HU-E7-06: the space of a personal row that does not merge, so the web UI writes "space / group" (HU-E9-11). */
const SpaceRefSchema = z.object({ id: z.string(), name: z.string() }).nullable();

const groupSpace = SpaceRefSchema.describe("Null for a seeded group merged across spaces by key.");
const categorySpace = SpaceRefSchema.describe(
  "Null for a seeded category merged inside a merged seeded group; a custom category keeps its space.",
);
const subcategorySpace = SpaceRefSchema.describe(
  "Null for the entry of what was spent in the category itself; otherwise the subcategory's space",
);

/** HU-E7-06: the caller's consumption (HU-E7-04) by group, category and subcategory, every level largest first. */
export const PersonalSpendingByGroupSchema = z.object({
  /** The personal space's currency, every amount's; spaces in another currency are left out (D6). */
  currency: z
    .string()
    .describe(
      "The personal space's currency, the currency of every amount; spaces in another currency are left out",
    ),
  /** The caller's personal-space period. */
  period: PeriodSchema,
  total: MoneySchema,
  /** Seeded groups and categories merge across spaces by catalog key (`id` and `space` null). */
  groups: z.array(
    z.object({
      ...spendingNode,
      id: z.string().nullable().describe("Null for a seeded group merged across spaces by key."),
      space: groupSpace,
      categories: z.array(
        z.object({
          ...spendingNode,
          id: z
            .string()
            .nullable()
            .describe(
              "Null for a seeded category merged inside a merged seeded group; a custom category keeps its id.",
            ),
          space: categorySpace,
          /** Listed per space: subcategories carry no catalog key (HU-E3-04). */
          subcategories: z.array(SubcategorySpendingSchema.extend({ space: subcategorySpace })),
        }),
      ),
    }),
  ),
});

export const personalSpendingByGroupDto = (
  report: PersonalSpendingByGroup,
): z.infer<typeof PersonalSpendingByGroupSchema> => ({
  currency: report.currency,
  period: periodDto(report.period),
  total: moneyOf(report.total, report.currency),
  groups: report.groups.map((group) => ({
    ...spendingNodeDto(group, report.currency),
    space: group.space,
    categories: group.categories.map((category) => ({
      ...spendingNodeDto(category, report.currency),
      space: category.space,
      subcategories: category.subcategories.map((entry) => ({
        ...subcategorySpendingDto(entry, report.currency),
        space: entry.space,
      })),
    })),
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
  "/api/v1/me/cash-flow": {
    get: {
      operationId: "getCashFlow",
      summary: "What comes into and goes out of the caller's own accounts over the next 30 or 60 days",
      description:
        "Every scheduled date of the active recurrences and every pending occurrence of the spaces the caller is a current member of, when it debits or credits an account the caller owns, with the projected balance of the personal space's available money after each date. Earlier due dates are listed on today.",
      ...securedByUser,
      requestParams: { query: CashFlowQuerySchema },
      responses: {
        "200": {
          description: "The caller's dated movements and projected balances",
          content: jsonContent(CashFlowSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/reports/spending-by-group": {
    get: {
      operationId: "getSpendingByGroup",
      summary:
        "A space's spending in a period by category group, then category, then subcategory; computed on read",
      description:
        "Every member reads it, archived spaces included. Live expenses count by amount, whoever paid, under the tree as it is now; nodes without spending are left out and each share is of its parent's total.",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ReportQuerySchema },
      responses: {
        "200": {
          description: "The groups with spending, largest first, each with its categories and subcategories",
          content: jsonContent(SpendingByGroupSchema),
        },
        ...reportProblems,
      },
    },
  },
  "/api/v1/me/reports/spending-by-group": {
    get: {
      operationId: "getPersonalSpendingByGroup",
      summary: "The caller's consumption in a personal period by category group, category and subcategory",
      description:
        "The unified view's consumption, from the caller's own member rows only. Seeded groups, and seeded categories inside them, merge across spaces by catalog key, with id and space null; custom groups, every category inside one, and custom categories inside a seeded group keep their id and space.",
      ...securedByUser,
      requestParams: { query: ReportQuerySchema },
      responses: {
        "200": {
          description:
            "The caller's groups with consumption, largest first, in the personal space's currency",
          content: jsonContent(PersonalSpendingByGroupSchema),
        },
        ...problems({ "401": "Unauthenticated", "422": "ValidationFailed, InvalidPeriodLabel" }),
      },
    },
  },
};
