import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  basisPointsOf,
  jsonContent,
  moneyFromDto,
  moneyOf,
  MoneySchema,
  percentOf,
  PercentSchema,
  PeriodSchema,
  periodDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import type { HttpSuccess } from "@/shared/http/define-route";
import { etagOf } from "@/shared/http/etag";
import { ok, type Money, type Result } from "@/shared/kernel";
import {
  ALLOCATION_RULES,
  FUNDINGS,
  PLAN_STATUSES,
  ROLLOVER_MODES,
  type AllocationInput,
  type BudgetPlanView,
  type CapacitySuggestion,
  type CopyDrops,
  type PlanCopy,
  type DefaultSplitView,
  type LineChanges,
  type LineFigure,
  type LineInput,
} from "../application";

const percentOrNull = (basisPoints: number | null): string | null =>
  basisPoints === null ? null : percentOf(basisPoints);

export const BudgetLineSchema = z.object({
  id: z.string(),
  /** HU-E6-06, HU-E6-09: the line of the previous period's plan this one was copied from; null for new lines. */
  originLineId: z.string().nullable(),
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
  /** HU-E6-09: carried from the line this one was copied from (`originLineId`), by this line's rollover mode. */
  carryOver: MoneySchema.describe(
    "Since M6c a line carries only from the CLOSED plan it was copied from, and only from its origin line there: carryOver is 0 while that plan is DRAFT or ACTIVE (before, it carried whatever the source's status was), and carryOverFrom names the plan it comes from or waits for. Nothing is stored; both are derived on read.",
  ),
  /**
   * Ruling P243 (M6c): the plan the carry-over comes from, and whether it is CLOSED. A line carries only from the
   * CLOSED plan it was copied from, and only from its origin line there, so `closed: false` means it carries 0 until
   * that plan closes. Null for RESET, or for a line without an origin in the source (a new line carries nothing).
   */
  carryOverFrom: z
    .object({ planId: z.string(), period: PeriodSchema.extend({}), closed: z.boolean() })
    .nullable()
    .describe(
      "The plan the carry-over comes from, with its period and whether it is CLOSED. closed false means the line carries 0 until that plan closes. Null for a RESET line, a line without an origin in that plan (a line added by hand, or one the source no longer has) and a plan that was not copied.",
    ),
  /** planned + carry-over − spent, computed on read (D7). */
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
  /**
   * HU-E6-06: only in the answer to a copy (`copyFrom: "previous"`), what it left out (rulings P10, P11): mappings to
   * archived categories and savings accounts that no longer qualify, by the copied line, and SAVINGS lines
   * left without accounts, by the source line.
   */
  dropped: z
    .object({
      mappings: z.array(z.object({ lineId: z.string(), categoryId: z.string() })),
      savingsAccounts: z.array(z.object({ lineId: z.string(), accountId: z.string() })),
      lines: z.array(z.object({ originLineId: z.string(), name: z.string() })),
    })
    .optional(),
});

/**
 * HU-E6-01: the period's label in the space policy, e.g. "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY).
 * HU-E6-06: with `copyFrom: "previous"`, the plan of the previous period of the policy is copied into it.
 */
export const CreatePlanBodySchema = z.object({
  period: z.string().max(20),
  copyFrom: z.enum(["previous"]).optional(),
});

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

/** HU-E6-02, D17: only ever the caller's own suggestion. */
export const CapacitySuggestionSchema = z.object({
  memberId: z.string(),
  /** The period whose income is suggested: the one before the plan's (spec 5.3). */
  period: PeriodSchema,
  /** Null when the caller's personal space keeps another currency (no conversion, D6). */
  suggested: MoneySchema.nullable(),
});

export const capacitySuggestionDto = (s: CapacitySuggestion): z.infer<typeof CapacitySuggestionSchema> => ({
  memberId: s.memberId,
  period: periodDto(s.period),
  suggested: s.suggested === null ? null : moneyOf(s.suggested, s.currency),
});

/** Savings accounts per line: bounds the payload; ownership is checked by the use case. */
const MAX_ACCOUNTS = 20;

/** HU-E6-03: a new line; DIRECT and RESET unless given, and not the catch-all unless asked (HU-E6-04). */
export const AddLineBodySchema = z.object({
  name: z.string().max(200),
  plannedAmount: MoneySchema,
  funding: z.enum(FUNDINGS).optional(),
  rolloverMode: z.enum(ROLLOVER_MODES).optional(),
  savingsAccountIds: z.array(Id).max(MAX_ACCOUNTS).optional(),
  isCatchAll: z.boolean().optional(),
});

/** HU-E6-03: the body as AddBudgetLine takes it; fails only for currencies the kernel does not know. */
export const lineFromBody = (body: z.infer<typeof AddLineBodySchema>): Result<LineInput> => {
  const plannedAmount = moneyFromDto(body.plannedAmount);
  return plannedAmount.ok ? ok({ ...body, plannedAmount: plannedAmount.value }) : plannedAmount;
};

/**
 * HU-E6-03, HU-E6-04: what a PATCH changes, at least one field; `isCatchAll` makes the line the plan's
 * catch-all (SetCatchAllLine). Unknown fields are stripped before the check, so a body with only those is empty.
 */
export const UpdateLineBodySchema = z
  .object({
    name: z.string().max(200).optional(),
    plannedAmount: MoneySchema.optional(),
    funding: z.enum(FUNDINGS).optional(),
    rolloverMode: z.enum(ROLLOVER_MODES).optional(),
    savingsAccountIds: z.array(Id).max(MAX_ACCOUNTS).optional(),
    isCatchAll: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: "Provide at least one field to change",
  });

/** The body as UpdateBudgetLine takes it; fails only for currencies the kernel does not know. */
export const lineChangesFromBody = (body: z.infer<typeof UpdateLineBodySchema>): Result<LineChanges> => {
  if (body.plannedAmount === undefined) return ok({ ...body, plannedAmount: undefined });
  const plannedAmount = moneyFromDto(body.plannedAmount);
  return plannedAmount.ok ? ok({ ...body, plannedAmount: plannedAmount.value }) : plannedAmount;
};

/** Categories per line: bounds the payload; the use case checks that each is a category of the space. */
const MAX_CATEGORIES = 200;

/** HU-E6-04: the line's whole category set; categories left out are unmapped (the rows stay, D8). */
export const MapCategoriesBodySchema = z.object({ categoryIds: z.array(Id).max(MAX_CATEGORIES) });

/** HU-E6-05: one rule per line; PERCENT and FIXED name current members (guests too) with positive values. */
export const AllocationBodySchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("PROPORTIONAL") }),
  z.object({ rule: z.literal("NONE") }),
  z.object({
    rule: z.literal("PERCENT"),
    members: z.array(z.object({ memberId: Id, percent: PercentSchema })).max(MAX_MEMBERS),
  }),
  z.object({
    rule: z.literal("FIXED"),
    members: z.array(z.object({ memberId: Id, amount: MoneySchema })).max(MAX_MEMBERS),
  }),
]);

/** The body as AllocateBudgetLine takes it: percentages become basis points and FIXED amounts Money. */
export const allocationFromBody = (body: z.infer<typeof AllocationBodySchema>): Result<AllocationInput> => {
  switch (body.rule) {
    case "PROPORTIONAL":
      return ok({ rule: "PROPORTIONAL" as const });
    case "NONE":
      return ok({ rule: "NONE" as const });
    case "PERCENT":
      return ok({
        rule: "PERCENT" as const,
        members: body.members.map((m) => ({ memberId: m.memberId, basisPoints: basisPointsOf(m.percent) })),
      });
    case "FIXED": {
      const members: { memberId: string; amount: Money }[] = [];
      for (const m of body.members) {
        const amount = moneyFromDto(m.amount);
        if (!amount.ok) return amount;
        members.push({ memberId: m.memberId, amount: amount.value });
      }
      return ok({ rule: "FIXED" as const, members });
    }
  }
};

/** HU-E6-08: the expense whose default split is previewed; `amount` in minor units of the space currency. */
export const DefaultSplitQuerySchema = z.object({
  categoryId: Id,
  date: z.iso.date(),
  // At most 18 digits (below 10^18 minor units, under the ledger's int64 bound), so any value it accepts fits and
  // BigInt() only ever sees what matched; a preview needs no amount beyond that.
  amount: z
    .string()
    .regex(/^[1-9]\d{0,17}$/, { error: "A positive amount in minor units, digits only" })
    .optional(),
});

/** HU-E6-08: the default method, what a member may pick instead, the line it follows and the preview of the amount. */
export const DefaultSplitSchema = z.object({
  method: z.enum(["BY_ALLOCATION", "EQUAL"]),
  /** BY_ALLOCATION is listed only when it is the default; a client gets it by sending no split. */
  availableMethods: z.array(z.enum(["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"])),
  /** The line of the ACTIVE plan covering the date that the category consumes; null without one. */
  lineId: z.string().nullable(),
  /** The amount shared by the default, in join order; null without an amount. */
  shares: z.array(z.object({ memberId: z.string(), amount: MoneySchema })).nullable(),
});

export const defaultSplitDto = (view: DefaultSplitView): z.infer<typeof DefaultSplitSchema> => ({
  method: view.method,
  availableMethods: [...view.availableMethods],
  lineId: view.lineId,
  shares:
    view.shares === null
      ? null
      : view.shares.map((s) => ({ memberId: s.memberId, amount: moneyOf(s.amount, view.currency) })),
});

const lineDto = (figure: LineFigure, currency: string): z.infer<typeof BudgetLineSchema> => {
  const { line, allocation } = figure;
  return {
    id: line.id,
    originLineId: line.originLineId,
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
    carryOver: moneyOf(figure.carryOver, currency),
    carryOverFrom:
      figure.carryOverFrom === null
        ? null
        : {
            planId: figure.carryOverFrom.planId,
            period: periodDto(figure.carryOverFrom.period),
            closed: figure.carryOverFrom.closed,
          },
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

const droppedDto = (dropped: CopyDrops): NonNullable<z.infer<typeof BudgetPlanSchema>["dropped"]> => ({
  mappings: dropped.mappings.map((m) => ({ lineId: m.lineId, categoryId: m.categoryId })),
  savingsAccounts: dropped.savingsAccounts.map((s) => ({ lineId: s.lineId, accountId: s.accountId })),
  lines: dropped.lines.map((l) => ({ originLineId: l.originLineId, name: l.name })),
});

/** HU-E6-06: 201 like a creation, its body also listing what the copy left out (ruling P11). */
export const planCopied = ({ view, dropped }: PlanCopy): HttpSuccess => ({
  ...planCreated(view),
  body: { ...budgetPlanDto(view), dropped: droppedDto(dropped) },
});

const SpacePath = z.object({ spaceId: z.string() });
const PlanPath = SpacePath.extend({ planId: z.string() });
const LinePath = PlanPath.extend({ lineId: z.string() });
const planResponse = (description: string) => ({ description, content: jsonContent(BudgetPlanSchema) });

const IfMatchHeader = z.object({ "if-match": z.string().optional() });

/**
 * A write to a plan (HU-E6-02 … HU-E6-07): If-Match is optional, and the answer is the plan with its new ETag. Every
 * edit of a plan or its parts answers 409 PeriodClosed once the plan is CLOSED; its transitions (`editsPlan` false)
 * answer InvalidPlanTransition instead.
 */
const planWrite = <P extends z.ZodObject>(
  operationId: string,
  summary: string,
  path: P,
  body: z.ZodType | null,
  errors: Record<string, string>,
  status: "200" | "201" = "200",
  editsPlan = true,
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
      ...(editsPlan ? { "409": ["PeriodClosed", errors["409"]].filter(Boolean).join(", ") } : {}),
    }),
  },
});

export const budgetingPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/plans": {
    post: {
      operationId: "createBudgetPlan",
      summary:
        "Create a DRAFT plan for a period of the space's policy, empty or copied from the previous period's plan",
      description:
        "The period's boundaries are stored (D10). With copyFrom: previous, the plan covering the day before the period starts is deep-copied with new ids. Capacities and allocation values of former members are left out without being listed. The answer's dropped member, present only in the answer to a copy, lists mappings to archived categories and savings accounts that no longer qualify, by the copied line, and SAVINGS lines left without accounts, which are not copied, by their source line.",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreatePlanBodySchema) },
      responses: {
        "201": planResponse("The new plan; ETag carries its version, Location its URL"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "PlanAlreadyExists, NoPreviousPlan, SpaceArchived",
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
        "422":
          "ValidationFailed, InvalidCapacity, ViewerCannotHoldCapacity, NotASpaceMember, CurrencyMismatch, UnknownCurrency",
      },
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": {
    get: {
      operationId: "suggestCapacity",
      summary:
        "The caller's own previous-period personal income as a capacity suggestion; saved nowhere (D17)",
      ...securedByUser,
      requestParams: { path: PlanPath },
      responses: {
        "200": { description: "The caller's suggestion", content: jsonContent(CapacitySuggestionSchema) },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound, BudgetPlanNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines": {
    post: planWrite(
      "addBudgetLine",
      "Add a line with a planned amount, funding and rollover mode; Σ planned never exceeds total capacity",
      PlanPath,
      AddLineBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, AccountNotFound",
        "409":
          "PlanExceedsCapacity, BudgetLineNameTaken, CatchAllLineAlreadySet, SavingsAccountAlreadyUsed, SavingsLineNotMappable, AccountArchived, SpaceArchived",
        "422":
          "ValidationFailed, InvalidBudgetLineName, InvalidPlannedAmount, SavingsAccountRequired, InvalidSavingsAccount, CurrencyMismatch, UnknownCurrency",
      },
      "201",
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": {
    patch: {
      ...planWrite(
        "updateBudgetLine",
        "Change a line's name, planned amount, funding, savings accounts, rollover mode or catch-all flag",
        LinePath,
        UpdateLineBodySchema,
        {
          "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound, AccountNotFound",
          "409":
            "PlanExceedsCapacity, BudgetLineNameTaken, CatchAllLineAlreadySet, SavingsAccountAlreadyUsed, SavingsLineNotMappable, AccountArchived, SpaceArchived",
          "422":
            "ValidationFailed, InvalidBudgetLineName, InvalidPlannedAmount, SavingsAccountRequired, InvalidSavingsAccount, CurrencyMismatch, UnknownCurrency",
        },
      ),
      description:
        "The body needs at least one field: an empty body, or one with only unknown fields, answers 422 ValidationFailed. Like every plan write it bumps the plan's version, even when the change repeats what the line already holds.",
    },
    delete: planWrite(
      "removeBudgetLine",
      "Remove a line logically: its row stays, it leaves every figure and frees its name and categories",
      LinePath,
      null,
      { "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound", "409": "SpaceArchived" },
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories": {
    put: planWrite(
      "mapCategoriesToLine",
      "Replace the categories a line consumes; a category maps to one line per plan, unmapped ones to the catch-all",
      LinePath,
      MapCategoriesBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound",
        "409":
          "CategoryAlreadyMapped, CategoryArchived, SavingsLineNotMappable, SpaceArchived, SubcategoryNotMappable",
        "422": "ValidationFailed, CategoryNotInSpace",
      },
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": {
    put: planWrite(
      "allocateBudgetLine",
      "Allocate a line among members proportionally to capacity, by percentage, by fixed amount, or not at all",
      LinePath,
      AllocationBodySchema,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound, BudgetLineNotFound",
        "409": "SpaceArchived",
        "422":
          "ValidationFailed, InvalidAllocation, ViewerCannotHoldAllocation, NotASpaceMember, CurrencyMismatch, UnknownCurrency",
      },
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/activate": {
    post: planWrite(
      "activateBudgetPlan",
      "Activate a DRAFT plan whose lines fit its capacity and whose every allocation holds; it then drives default splits",
      PlanPath,
      null,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409":
          "InvalidPlanTransition, PlanExceedsCapacity, CopyAlreadyClosed (a plan copied from this one is already CLOSED and carries over from it; the problem carries the closed copy's `copyPeriod`), SpaceArchived",
        "422": "InvalidAllocation (lineIds names the lines whose allocation does not hold)",
      },
      "200",
      false,
    ),
  },
  "/api/v1/spaces/{spaceId}/plans/{planId}/close": {
    post: planWrite(
      "closeBudgetPlan",
      "Close an ACTIVE plan once its period has ended: it and the space's transactions dated in its period can no longer be edited; its derived figures may still move",
      PlanPath,
      null,
      {
        "404": "SpaceNotFound, BudgetPlanNotFound",
        "409":
          "InvalidPlanTransition, PeriodNotOver (today is not after the period's last day), SourcePlanOpen (the plan it was copied from is still ACTIVE and a line carries over from it; the problem carries the source's `sourcePeriod`), SpaceArchived",
      },
      "200",
      false,
    ),
  },
  "/api/v1/spaces/{spaceId}/default-split": {
    get: {
      operationId: "resolveDefaultSplit",
      summary:
        "The default split of an expense in a category on a date: BY_ALLOCATION by its line in the ACTIVE plan, else EQUAL",
      ...securedByUser,
      requestParams: { path: SpacePath, query: DefaultSplitQuerySchema },
      responses: {
        "200": {
          description: "The default method, the methods a member may pick and the preview of the amount",
          content: jsonContent(DefaultSplitSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidDate, CategoryNotInSpace",
        }),
      },
    },
  },
};
