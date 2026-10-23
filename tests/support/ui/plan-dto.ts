import type {
  BudgetPlanDto,
  LineDashboardDto,
  PlanLineDto,
  SpaceDto,
  SpaceMemberDto,
} from "@/shared/ui/api/dto";
import { cop, spaceDto } from "./dto";

/** "Household": Ana's shared space, OWNER, MONTHLY(1), COP. */
export const householdDto = (overrides: Partial<SpaceDto> = {}): SpaceDto =>
  spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "OWNER", ...overrides });

export const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" } as const;

type DashLine = LineDashboardDto["lines"][number];
const dashLine = (
  lineId: string,
  name: string,
  [planned, spent, available]: readonly [number, number, number],
  extra: Partial<DashLine> = {},
): DashLine => ({
  lineId,
  name,
  funding: "DIRECT",
  isCatchAll: false,
  planned: cop(planned),
  spent: cop(spent),
  carryOver: cop(0),
  // Task 1e (ruling P243): where a carry-over comes from; null for a line that carries nothing.
  carryOverFrom: null,
  available: cop(available),
  overspent: available < 0,
  // Task 1b: the line's state and its overage.
  state: available < 0 ? "OVER" : "OK",
  overBy: available < 0 ? cop(-available) : null,
  ...extra,
});

/** HU-E7-01's November 2026 dashboard of the E7 shared fixture, with the totals the API answers (Task 1). */
export const e7Dashboard = (overrides: Partial<LineDashboardDto> = {}): LineDashboardDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  lines: [
    dashLine("l-rent", "Rent", [1_200_000, 1_200_000, 0], { funding: "SHARED_FUND", state: "HIGH" }),
    dashLine("l-home", "Home", [1_470_000, 1_300_000, 170_000], { state: "NEAR" }),
    dashLine("l-savings", "Savings", [600_000, 0, 600_000], { funding: "SAVINGS" }),
    dashLine("l-free", "Free", [730_000, 250_000, 480_000]),
  ],
  unbudgeted: { spent: cop(60_000), available: cop(-60_000), overspent: true },
  totals: { planned: cop(4_000_000), spent: cop(2_810_000), available: cop(1_190_000) },
  // Task 1b (ruling P234): the line each category consumes.
  categoryLines: [
    { categoryId: "c-rent", lineId: "l-rent" },
    { categoryId: "c-groceries", lineId: "l-home" },
    { categoryId: "c-utilities", lineId: "l-home" },
    { categoryId: "c-entertainment", lineId: "l-free" },
    { categoryId: "c-restaurants", lineId: null },
  ],
  ...overrides,
});

/** Ana, OWNER of Household. */
export const spaceMemberDto = (overrides: Partial<SpaceMemberDto> = {}): SpaceMemberDto => ({
  id: "m-ana",
  kind: "USER",
  userId: "u-ana",
  displayName: "Ana",
  role: "OWNER",
  contactEmail: null,
  joinedAt: "2026-10-01T12:00:00.000Z",
  ...overrides,
});

/** HU-E9-08 Background: Ana is OWNER and Juan is MEMBER of Household, in join order. */
export const HOUSEHOLD_MEMBERS: SpaceMemberDto[] = [
  spaceMemberDto(),
  spaceMemberDto({
    id: "m-juan",
    userId: "u-juan",
    displayName: "Juan",
    role: "MEMBER",
    joinedAt: "2026-10-02T12:00:00.000Z",
  }),
];

const proportional = (ana: number, juan: number): PlanLineDto["allocation"] => ({
  rule: "PROPORTIONAL",
  members: [
    { memberId: "m-ana", percent: null, amount: null, assigned: cop(ana) },
    { memberId: "m-juan", percent: null, amount: null, assigned: cop(juan) },
  ],
  error: null,
});

/** "Home": 1,470,000 COP, DIRECT, RESET, proportional to capacity (40 % / 60 %), nothing spent. */
export const planLineDto = (overrides: Partial<PlanLineDto> = {}): PlanLineDto => ({
  id: "l-home",
  originLineId: null,
  name: "Home",
  plannedAmount: cop(1_470_000),
  funding: "DIRECT",
  rolloverMode: "RESET",
  isCatchAll: false,
  savingsAccountIds: [],
  categoryIds: [],
  capacityShare: "36.75",
  allocation: proportional(588_000, 882_000),
  spent: cop(0),
  carryOver: cop(0),
  carryOverFrom: null,
  available: cop(1_470_000),
  ...overrides,
});

/** HU-E9-08's reference plan for 2026-11 in Household: DRAFT, version 7, all 4,000,000 COP of capacity planned. */
export const referencePlanDto = (overrides: Partial<BudgetPlanDto> = {}): BudgetPlanDto => ({
  id: "p-nov",
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  status: "DRAFT",
  createdFrom: null,
  version: 7,
  capacities: [
    { memberId: "m-ana", amount: cop(1_600_000), share: "40.00" },
    { memberId: "m-juan", amount: cop(2_400_000), share: "60.00" },
  ],
  totalCapacity: cop(4_000_000),
  planned: cop(4_000_000),
  unallocated: cop(0),
  lines: [
    planLineDto({
      id: "l-rent",
      name: "Rent",
      plannedAmount: cop(1_200_000),
      funding: "SHARED_FUND",
      capacityShare: "30.00",
      allocation: proportional(480_000, 720_000),
      available: cop(1_200_000),
    }),
    planLineDto(),
    planLineDto({
      id: "l-savings",
      name: "Savings",
      plannedAmount: cop(600_000),
      funding: "SAVINGS",
      savingsAccountIds: ["a-savings"],
      capacityShare: "15.00",
      allocation: proportional(240_000, 360_000),
      available: cop(600_000),
    }),
    planLineDto({
      id: "l-free",
      name: "Free",
      plannedAmount: cop(730_000),
      isCatchAll: true,
      capacityShare: "18.25",
      allocation: proportional(292_000, 438_000),
      available: cop(730_000),
    }),
  ],
  unbudgeted: null,
  ...overrides,
});

/** The reference plan with "Free" allocated PERCENT 42 % / 57 %: stored before a member's value went stale (P7). */
export const freeAt99 = (plan = referencePlanDto()): BudgetPlanDto => ({
  ...plan,
  lines: plan.lines.map((line) =>
    line.id === "l-free"
      ? {
          ...line,
          allocation: {
            rule: "PERCENT",
            members: [
              { memberId: "m-ana", percent: "42.00", amount: null, assigned: null },
              { memberId: "m-juan", percent: "57.00", amount: null, assigned: null },
            ],
            error: "InvalidAllocation",
          },
        }
      : line,
  ),
});

/** HU-E9-08 "Copy the previous plan": December copied from November; "Utilities" (archived) left Home's mapping. */
export const copiedPlanDto = (): BudgetPlanDto => {
  const november = referencePlanDto();
  return {
    ...november,
    id: "p-dec",
    period: { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" },
    createdFrom: "p-nov",
    version: 1,
    lines: november.lines.map((line) => ({ ...line, id: `${line.id}-dec`, originLineId: line.id })),
    dropped: {
      mappings: [{ lineId: "l-home-dec", categoryId: "c-utilities" }],
      savingsAccounts: [],
      lines: [],
    },
  };
};
