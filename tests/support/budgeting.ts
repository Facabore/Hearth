import { GET as getPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { GET as suggestionRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route";
import { call, type TestUser } from "./app";
import { cop, type MoneyDto } from "./ledger";

export interface AllocationMemberDto {
  memberId: string;
  percent: string | null;
  amount: MoneyDto | null;
  assigned: MoneyDto | null;
}
export interface LineDto {
  id: string;
  name: string;
  plannedAmount: MoneyDto;
  funding: string;
  rolloverMode: string;
  isCatchAll: boolean;
  savingsAccountIds: string[];
  categoryIds: string[];
  capacityShare: string | null;
  allocation: { rule: string; members: AllocationMemberDto[]; error: string | null };
  spent: MoneyDto;
  available: MoneyDto;
}
export interface PlanDto {
  id: string;
  spaceId: string;
  period: { label: string; startDate: string; endDate: string };
  status: string;
  createdFrom: string | null;
  version: number;
  capacities: { memberId: string; amount: MoneyDto; share: string | null }[];
  totalCapacity: MoneyDto;
  planned: MoneyDto;
  unallocated: MoneyDto;
  lines: LineDto[];
  unbudgeted: { spent: MoneyDto; available: MoneyDto } | null;
}

export const plansPath = (spaceId: string, rest = "") => `/api/v1/spaces/${spaceId}/plans${rest}`;

/** HU-E6-01: `user` asks for a plan for `period` ("2026-11", "2026-11 H1") in `spaceId`. */
export const createPlan = (user: TestUser, spaceId: string, period: string) =>
  call(createPlanRoute, "POST", plansPath(spaceId), { user, params: { spaceId }, body: { period } });

/** Creates the plan; throws unless it was created. */
export const newPlan = async (user: TestUser, spaceId: string, period: string): Promise<PlanDto> => {
  const response = await createPlan(user, spaceId, period);
  if (response.status !== 201) throw new Error(`plan creation failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

export const getPlan = (user: TestUser, spaceId: string, planId: string) =>
  call(getPlanRoute, "GET", plansPath(spaceId, `/${planId}`), { user, params: { spaceId, planId } });

/** The plan as `user` reads it; throws unless 200. */
export const planOf = async (user: TestUser, spaceId: string, planId: string): Promise<PlanDto> => {
  const response = await getPlan(user, spaceId, planId);
  if (response.status !== 200) throw new Error(`plan read failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

/** `If-Match: "<version>"` when a version is given. */
export const ifMatch = (version?: number): Record<string, string> =>
  version === undefined ? {} : { "if-match": `"${version}"` };

/** HU-E6-02: `user` sets the capacities of `[memberId, pesos]` pairs. */
export const putCapacities = (
  user: TestUser,
  spaceId: string,
  planId: string,
  capacities: [string, number][],
  version?: number,
) =>
  call(putCapacitiesRoute, "PUT", plansPath(spaceId, `/${planId}/capacities`), {
    user,
    params: { spaceId, planId },
    body: { capacities: capacities.map(([memberId, pesos]) => ({ memberId, amount: cop(pesos) })) },
    headers: ifMatch(version),
  });

/** Sets the capacities and returns the plan; throws unless 200. */
export const setCapacities = async (...args: Parameters<typeof putCapacities>): Promise<PlanDto> => {
  const response = await putCapacities(...args);
  if (response.status !== 200) throw new Error(`capacities failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

/** HU-E6-02, D17: the caller's own capacity suggestion. */
export const getSuggestion = (user: TestUser, spaceId: string, planId: string) =>
  call(suggestionRoute, "GET", plansPath(spaceId, `/${planId}/capacity-suggestion`), {
    user,
    params: { spaceId, planId },
  });
