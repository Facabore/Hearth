import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";
import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";
import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";
import { GET as unifiedRoute } from "@/app/api/v1/me/unified-view/route";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { call, type RouteHandler, type TestUser } from "./app";
import { putCategories, referencePlan } from "./budgeting";
import { categoryWithKey, cop, newAccount, post, type HouseholdMember, type MoneyDto } from "./ledger";

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
      category: { id: string; name: string | null } | null;
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
