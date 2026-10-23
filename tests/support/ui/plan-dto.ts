import type {
  BudgetPlanDto,
  FundTrackingDto,
  LineDashboardDto,
  LineTrendDto,
  MemberMatrixDto,
  PersonalSpendingByGroupDto,
  PersonalTrendDto,
  PlanLineDto,
  SpaceDto,
  SpaceMemberDto,
  SpendingByGroupDto,
  UnifiedViewDto,
} from "@/shared/ui/api/dto";
import { accountDto, cop, spaceDto } from "./dto";

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

/** Ana's "Ahorros": a SAVINGS account of her personal space, the one the reference Savings line names. */
export const savingsAccountDto = () =>
  accountDto({ id: "a-savings", name: "Ahorros", type: "SAVINGS", icon: "piggy" });

type MatrixCell = MemberMatrixDto["lines"][number]["members"][number];
const cell = (
  memberId: string,
  [assigned, contributed, consumed, gap]: readonly (number | null)[],
  status: MatrixCell["status"] = null,
): MatrixCell => {
  const money = (pesos: number | null | undefined) =>
    pesos === null || pesos === undefined ? null : cop(pesos);
  return {
    memberId,
    assigned: money(assigned),
    contributed: money(contributed),
    consumed: money(consumed),
    gap: money(gap),
    status,
  };
};

/** HU-E7-02's November matrix: Rent tracked at fund level, Home per member, Free not allocated. */
export const e7Matrix = (): MemberMatrixDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  lines: [
    {
      lineId: "l-rent",
      name: "Rent",
      funding: "SHARED_FUND",
      rule: "PROPORTIONAL",
      reason: "TRACKED_AT_FUND_LEVEL",
      members: [
        cell("m-ana", [480_000, null, 480_000, null]),
        cell("m-juan", [720_000, null, 720_000, null]),
      ],
    },
    {
      lineId: "l-home",
      name: "Home",
      funding: "DIRECT",
      rule: "PROPORTIONAL",
      reason: null,
      members: [
        cell("m-ana", [588_000, 900_000, 520_000, 312_000], "OVER_CONTRIBUTED"),
        cell("m-juan", [882_000, 400_000, 780_000, -482_000], "UNDER_CONTRIBUTED"),
      ],
    },
    {
      lineId: "l-free",
      name: "Free",
      funding: "DIRECT",
      rule: "NONE",
      reason: "NOT_ALLOCATED",
      members: [cell("m-ana", [null, null, 125_000, null]), cell("m-juan", [null, null, 125_000, null])],
    },
  ],
});

/** HU-E9-10 "Fund tracking": Ana paid in 480,000 COP on 2026-11-02 and Juan 500,000 COP on 2026-11-03. */
export const e7Fund = (overrides: Partial<FundTrackingDto> = {}): FundTrackingDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  members: [
    { memberId: "m-ana", expected: cop(480_000), actual: cop(480_000), difference: cop(0) },
    { memberId: "m-juan", expected: cop(720_000), actual: cop(500_000), difference: cop(-220_000) },
  ],
  totals: { expected: cop(1_200_000), actual: cop(980_000), difference: cop(-220_000) },
  ...overrides,
});

type Group = SpendingByGroupDto["groups"][number];
type GroupCategory = Group["categories"][number];
const sub = (subcategoryId: string | null, name: string | null, pesos: number, share: string) => ({
  subcategoryId,
  name,
  archived: false,
  total: cop(pesos),
  share,
});
const category = (
  id: string,
  name: string,
  pesos: number,
  share: string,
  subcategories = [sub(null, null, pesos, "100.00")],
): GroupCategory => ({
  id,
  key: null,
  name,
  archived: false,
  total: cop(pesos),
  share,
  subcategories,
});
const group = (
  id: string,
  name: string,
  pesos: number,
  share: string,
  categories: GroupCategory[],
): Group => ({
  id,
  key: null,
  name,
  archived: false,
  total: cop(pesos),
  share,
  categories,
});

/** HU-E9-10 "Spending by group": the E7 November expenses, Groceries split into its subcategories. */
export const e7Groups = (): SpendingByGroupDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  total: cop(2_810_000),
  groups: [
    group("g-housing", "Housing", 1_600_000, "56.94", [
      category("c-rent", "Rent", 1_200_000, "75.00"),
      category("c-utilities", "Utilities", 400_000, "25.00"),
    ]),
    group("g-food", "Food", 960_000, "34.16", [
      category("c-groceries", "Groceries", 900_000, "93.75", [
        sub(null, null, 450_000, "50.00"),
        sub("c-veg", "Vegetables", 270_000, "30.00"),
        sub("c-meat", "Meat", 180_000, "20.00"),
      ]),
      category("c-dining", "Restaurants", 60_000, "6.25"),
    ]),
    group("g-leisure", "Leisure", 250_000, "8.90", [category("c-fun", "Entertainment", 250_000, "100.00")]),
  ],
});

/** HU-E7-04's November 2026 for Ana: consumption 1,575,000 COP and cash out 2,625,000 COP. */
export const e74Unified = (overrides: Partial<UnifiedViewDto> = {}): UnifiedViewDto => ({
  currency: "COP",
  period: { ...NOVEMBER },
  consumption: {
    total: cop(1_575_000),
    categories: [
      { key: "groceries", name: "Groceries", space: null, category: null, amount: cop(1_035_000) },
      { key: "rent", name: "Rent", space: null, category: null, amount: cop(480_000) },
      { key: "restaurants", name: "Restaurants", space: null, category: null, amount: cop(60_000) },
    ],
  },
  cashOut: {
    total: cop(2_625_000),
    payments: cop(2_145_000),
    fundContributions: cop(480_000),
    savingsTransfers: cop(0),
    outsideTheApp: cop(0),
  },
  otherCurrencySpaces: [],
  ...overrides,
});

type PersonalGroup = PersonalSpendingByGroupDto["groups"][number];
type PersonalCategory = PersonalGroup["categories"][number];
const household = { id: "sp-household", name: "Household" };
const personalCategory = (
  name: string,
  pesos: number,
  share: string,
  extra: Partial<PersonalCategory> = {},
): PersonalCategory => ({
  id: null,
  key: name.toLowerCase(),
  name,
  archived: false,
  total: cop(pesos),
  share,
  space: null,
  subcategories: [
    { subcategoryId: null, name: null, archived: false, total: cop(pesos), share: "100.00", space: null },
  ],
  ...extra,
});

/** HU-E9-11 "Spending by group": Food and Housing merged by key, the custom "Pets" of Household by its space. */
export const e74Groups = (): PersonalSpendingByGroupDto => ({
  currency: "COP",
  period: { ...NOVEMBER },
  total: cop(1_600_000),
  groups: [
    {
      id: null,
      key: "food",
      name: "Food",
      archived: false,
      total: cop(1_095_000),
      share: "68.44",
      space: null,
      categories: [
        personalCategory("Groceries", 1_035_000, "94.52"),
        personalCategory("Restaurants", 60_000, "5.48"),
      ],
    },
    {
      id: null,
      key: "housing",
      name: "Housing",
      archived: false,
      total: cop(480_000),
      share: "30.00",
      space: null,
      categories: [personalCategory("Rent", 480_000, "100.00")],
    },
    {
      id: "g-pets",
      key: null,
      name: "Pets",
      archived: false,
      total: cop(25_000),
      share: "1.56",
      space: household,
      categories: [personalCategory("Vet", 25_000, "100.00", { id: "c-vet", key: null, space: household })],
    },
  ],
});

const month = (label: string, last: number) => ({
  label,
  startDate: `${label}-01`,
  endDate: `${label}-${String(last).padStart(2, "0")}`,
});

/** HU-E9-11 "Six-period personal consumption chart": Ana's consumption from 2026-06 to 2026-11. */
export const sixMonthsTrend = (): PersonalTrendDto => ({
  currency: "COP",
  periods: [
    month("2026-06", 30),
    month("2026-07", 31),
    month("2026-08", 31),
    month("2026-09", 30),
    month("2026-10", 31),
    month("2026-11", 30),
  ],
  points: [
    {
      period: "2026-06",
      consumption: cop(1_400_000),
      change: null,
      changePercent: null,
      changeStatus: "NEW",
    },
    {
      period: "2026-07",
      consumption: cop(1_450_000),
      change: cop(50_000),
      changePercent: "3.57",
      changeStatus: "INCREASED",
    },
    {
      period: "2026-08",
      consumption: cop(1_450_000),
      change: cop(0),
      changePercent: "0.00",
      changeStatus: "UNCHANGED",
    },
    {
      period: "2026-09",
      consumption: cop(1_300_000),
      change: cop(-150_000),
      changePercent: "-10.34",
      changeStatus: "DECREASED",
    },
    {
      period: "2026-10",
      consumption: cop(1_500_000),
      change: cop(200_000),
      changePercent: "15.38",
      changeStatus: "INCREASED",
    },
    {
      period: "2026-11",
      consumption: cop(1_575_000),
      change: cop(75_000),
      changePercent: "5.00",
      changeStatus: "INCREASED",
    },
  ],
});

type TrendLine = LineTrendDto["lines"][number];
const quiet = (period: string) => ({
  period,
  spent: null,
  change: null,
  changePercent: null,
  changeStatus: null,
});

/** HU-E9-11: Home spent 1,350,000 COP in 2026-10 and 1,300,000 COP in 2026-11; Pets exists only in 2026-11. */
export const homeTrend = (): LineTrendDto => {
  const periods = [
    month("2026-06", 30),
    month("2026-07", 31),
    month("2026-08", 31),
    month("2026-09", 30),
    month("2026-10", 31),
    month("2026-11", 30),
  ];
  const early = periods.slice(0, 4).map((p) => quiet(p.label));
  const lines: TrendLine[] = [
    {
      lineId: "l-home",
      name: "Home",
      points: [
        ...early,
        { period: "2026-10", spent: cop(1_350_000), change: null, changePercent: null, changeStatus: "NEW" },
        {
          period: "2026-11",
          spent: cop(1_300_000),
          change: cop(-50_000),
          changePercent: "-3.70",
          changeStatus: "DECREASED",
        },
      ],
    },
    {
      lineId: "l-pets",
      name: "Pets",
      points: [
        ...early,
        quiet("2026-10"),
        { period: "2026-11", spent: cop(80_000), change: null, changePercent: null, changeStatus: "NEW" },
      ],
    },
  ];
  return { spaceId: "sp-household", periods, plan: { id: "p-nov", status: "ACTIVE" }, lines };
};
