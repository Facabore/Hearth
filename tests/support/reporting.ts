import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";
import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";
import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";
import { GET as unifiedRoute } from "@/app/api/v1/me/unified-view/route";
import { GET as lineTrendRoute } from "@/app/api/v1/spaces/[spaceId]/reports/trend/route";
import { GET as personalTrendRoute } from "@/app/api/v1/me/trend/route";
import { GET as spendingByGroupRoute } from "@/app/api/v1/spaces/[spaceId]/reports/spending-by-group/route";
import { GET as personalSpendingByGroupRoute } from "@/app/api/v1/me/reports/spending-by-group/route";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { PATCH as updateCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as createCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { call, type RouteHandler, type TestUser } from "./app";
import { putCategories, referencePlan } from "./budgeting";
import {
  categoryWithKey,
  cop,
  inSpace,
  newAccount,
  post,
  type HouseholdMember,
  type MoneyDto,
} from "./ledger";

export interface ReportPeriodDto {
  label: string;
  startDate: string;
  endDate: string;
}
export interface ReportPlanDto {
  id: string;
  status: string;
}
export interface DashboardLineDto {
  lineId: string;
  name: string;
  funding: string;
  isCatchAll: boolean;
  planned: MoneyDto;
  spent: MoneyDto;
  carryOver: MoneyDto;
  available: MoneyDto;
  overspent: boolean;
}
export interface LineDashboardDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  lines: DashboardLineDto[];
  unbudgeted: { spent: MoneyDto; available: MoneyDto; overspent: boolean } | null;
  totals: { planned: MoneyDto; spent: MoneyDto; available: MoneyDto };
}

/** GETs `path` with `query` in its search string as `user`; `params` are the route's path parameters. */
export const getWithQuery = (
  handler: RouteHandler,
  user: TestUser,
  path: string,
  query: Record<string, string | number>,
  params: Record<string, string> = {},
) => {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return call(handler, "GET", `${path}?${search.toString()}`, { user, params });
};

/** HU-E7-01: `user` reads the line dashboard of `spaceId`. */
export const getLineDashboard = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(linesRoute, user, `/api/v1/spaces/${spaceId}/reports/lines`, query, { spaceId });

/**
 * HU-E7 Background: `referencePlan()` (2026-11, DRAFT, no catch-all line, ruling P34) with Rent → Rent, Groceries and
 * Utilities → Home and Entertainment → Free (Restaurants unmapped), and the SHARED_FUND "Household Fund".
 */
export const reportHousehold = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const category = {
    rent: await categoryWithKey(h.ana, "rent"),
    groceries: h.groceries,
    utilities: await categoryWithKey(h.ana, "utilities"),
    entertainment: await categoryWithKey(h.ana, "entertainment"),
    restaurants: await categoryWithKey(h.ana, "restaurants"),
  };
  const map = async (line: string, categoryIds: string[]) => {
    const response = await putCategories(h.ana, h.spaceId, planId, lineId(line), categoryIds);
    if (response.status !== 200) throw new Error(`mapping failed with status ${response.status}`);
  };
  await map("Rent", [category.rent]);
  await map("Home", [category.groceries, category.utilities]);
  await map("Free", [category.entertainment]);
  return { ...ref, category, fund: await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND") };
};

/**
 * `payer` records an expense of `pesos` in the household on `date`, from their own account or from `fund`; without a
 * split, so the default split applies (spec 5.3: BY_ALLOCATION under an ACTIVE plan, else EQUAL).
 */
export const spend = async (
  payer: HouseholdMember,
  categoryId: string,
  pesos: number,
  date: string,
  fund?: string,
): Promise<void> => {
  const paidBy =
    fund === undefined
      ? { accountId: payer.account }
      : { payments: [{ memberId: null, accountId: fund, amount: cop(pesos) }] };
  const response = await post(recordExpense, payer, "expenses", {
    description: "Expense",
    date,
    categoryId,
    amount: cop(pesos),
    ...paidBy,
  });
  if (response.status !== 201) throw new Error(`expense failed with status ${response.status}`);
};

export interface MatrixCellDto {
  memberId: string;
  assigned: MoneyDto | null;
  contributed: MoneyDto | null;
  consumed: MoneyDto | null;
  gap: MoneyDto | null;
  status: string | null;
}
export interface MemberMatrixDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  lines: {
    lineId: string;
    name: string;
    funding: string;
    rule: string;
    reason: string | null;
    members: MatrixCellDto[];
  }[];
}

/** HU-E7-02: `user` reads the member by line matrix of `spaceId`. */
export const getMemberMatrix = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(matrixRoute, user, `/api/v1/spaces/${spaceId}/reports/member-matrix`, query, { spaceId });

export interface FundContributionsDto {
  spaceId: string;
  period: ReportPeriodDto;
  plan: ReportPlanDto | null;
  members: { memberId: string; expected: MoneyDto; actual: MoneyDto; difference: MoneyDto }[];
  totals: { expected: MoneyDto; actual: MoneyDto; difference: MoneyDto };
}

/** HU-E7-03: `user` reads the fund contribution tracking of `spaceId`. */
export const getFundContributions = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(fundRoute, user, `/api/v1/spaces/${spaceId}/reports/fund-contributions`, query, { spaceId });

/** HU-E4-09: `member` pays `pesos` into `fund` from their own account on `date`; throws unless 201. */
export const contribute = async (member: HouseholdMember, fund: string, pesos: number, date: string) => {
  const response = await post(recordContribution, member, "fund-contributions", {
    date,
    amount: cop(pesos),
    fundAccountId: fund,
    sourceAccountId: member.account,
  });
  if (response.status !== 201) throw new Error(`contribution failed with status ${response.status}`);
};

export interface UnifiedViewDto {
  currency: string;
  period: ReportPeriodDto;
  consumption: {
    total: MoneyDto;
    categories: {
      key: string | null;
      name: string;
      space: { id: string; name: string } | null;
      category: { id: string; name: string } | null;
      amount: MoneyDto;
    }[];
  };
  cashOut: {
    total: MoneyDto;
    payments: MoneyDto;
    fundContributions: MoneyDto;
    savingsTransfers: MoneyDto;
    outsideTheApp: MoneyDto;
  };
  otherCurrencySpaces: { spaceId: string; name: string; currency: string }[];
}

/** HU-E7-04: `user` reads their own unified view. */
export const getUnifiedView = (user: TestUser, query: Record<string, string>) =>
  getWithQuery(unifiedRoute, user, "/api/v1/me/unified-view", query);

export interface TrendPointDto {
  period: string;
  spent: MoneyDto | null;
  change: MoneyDto | null;
  changePercent: string | null;
  changeStatus: string | null;
}
export interface LineTrendDto {
  spaceId: string;
  periods: ReportPeriodDto[];
  plan: ReportPlanDto | null;
  lines: { lineId: string; name: string; points: TrendPointDto[] }[];
}

/** HU-E7-05: `user` reads the line trend of `spaceId`. */
export const getLineTrend = (user: TestUser, spaceId: string, query: Record<string, string | number>) =>
  getWithQuery(lineTrendRoute, user, `/api/v1/spaces/${spaceId}/reports/trend`, query, { spaceId });

export interface PersonalTrendDto {
  currency: string;
  periods: ReportPeriodDto[];
  points: {
    period: string;
    consumption: MoneyDto;
    change: MoneyDto | null;
    changePercent: string | null;
    changeStatus: string;
  }[];
}

/** HU-E7-05: `user` reads their own consumption trend. */
export const getPersonalTrend = (user: TestUser, query: Record<string, string | number>) =>
  getWithQuery(personalTrendRoute, user, "/api/v1/me/trend", query);

export interface SpendingNodeDto {
  id: string | null;
  key: string | null;
  name: string;
  archived: boolean;
  total: MoneyDto;
  share: string;
}
export interface SubcategorySpendingDto {
  subcategoryId: string | null;
  name: string | null;
  archived: boolean;
  total: MoneyDto;
  share: string;
}
export interface SpendingByGroupDto {
  spaceId: string;
  period: ReportPeriodDto;
  total: MoneyDto;
  groups: (SpendingNodeDto & {
    categories: (SpendingNodeDto & { subcategories: SubcategorySpendingDto[] })[];
  })[];
}

/** HU-E7-06: `user` reads the spending by group of `spaceId`. */
export const getSpendingByGroup = (user: TestUser, spaceId: string, query: Record<string, string>) =>
  getWithQuery(spendingByGroupRoute, user, `/api/v1/spaces/${spaceId}/reports/spending-by-group`, query, {
    spaceId,
  });

export interface SpaceRefDto {
  id: string;
  name: string;
}
export interface PersonalSpendingByGroupDto {
  currency: string;
  period: ReportPeriodDto;
  total: MoneyDto;
  groups: (SpendingNodeDto & {
    space: SpaceRefDto | null;
    categories: (SpendingNodeDto & {
      space: SpaceRefDto | null;
      subcategories: (SubcategorySpendingDto & { space: SpaceRefDto | null })[];
    })[];
  })[];
}

/** HU-E7-06: `user` reads their own spending by group. */
export const getPersonalSpendingByGroup = (user: TestUser, query: Record<string, string>) =>
  getWithQuery(personalSpendingByGroupRoute, user, "/api/v1/me/reports/spending-by-group", query);

/** HU-E3-02: `user` creates the category group `name` in their space; returns its id. */
export const newCategoryGroup = async (user: TestUser, name: string): Promise<string> => {
  const response = await call(createCategoryGroup, "POST", inSpace(user, "category-groups"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name },
  });
  if (response.status !== 201) throw new Error(`group creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** HU-E3-02, HU-E3-04: `user` creates `name` in a group, or as a subcategory of a category; returns its id. */
export const newCategory = async (
  user: TestUser,
  name: string,
  parent: { readonly groupId: string } | { readonly parentCategoryId: string },
): Promise<string> => {
  const response = await call(createCategory, "POST", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, ...parent },
  });
  if (response.status !== 201) throw new Error(`category creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** HU-E3-02: `user` moves the category `categoryId` to the group `groupId` of their space. */
export const moveCategory = async (user: TestUser, categoryId: string, groupId: string): Promise<void> => {
  const response = await call(updateCategory, "PATCH", inSpace(user, `categories/${categoryId}`), {
    user,
    params: { spaceId: user.spaceId, categoryId },
    body: { groupId },
  });
  if (response.status !== 200) throw new Error(`category move failed with status ${response.status}`);
};

/** HU-E3-05: the id of the seeded group with the catalog `key` in `user`'s space. */
export const groupWithKey = async (user: TestUser, key: string): Promise<string> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  if (response.status !== 200) throw new Error(`listing categories failed with status ${response.status}`);
  const { items } = (await response.json()) as { items: { id: string; key: string | null }[] };
  const group = items.find((g) => g.key === key);
  if (group === undefined) throw new Error(`no group with key "${key}" in space ${user.spaceId}`);
  return group.id;
};
