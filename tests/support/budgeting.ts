import { GET as getPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route";
import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { GET as suggestionRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route";
import {
  DELETE as deleteLineRoute,
  PATCH as patchLineRoute,
} from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { call, type TestUser } from "./app";
import { cop, household, newAccount, type MoneyDto } from "./ledger";

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

/** A line as the tests write it: `pesos` becomes `plannedAmount` in COP. */
export interface LineSpec {
  name: string;
  pesos: number;
  funding?: string;
  rolloverMode?: string;
  savingsAccountIds?: string[];
  isCatchAll?: boolean;
}

/** HU-E6-03: `user` adds a line to the plan. */
export const postLine = (
  user: TestUser,
  spaceId: string,
  planId: string,
  line: LineSpec,
  version?: number,
) => {
  const { pesos, ...fields } = line;
  return call(postLineRoute, "POST", plansPath(spaceId, `/${planId}/lines`), {
    user,
    params: { spaceId, planId },
    body: { ...fields, plannedAmount: cop(pesos) },
    headers: ifMatch(version),
  });
};

/** Adds the line and returns the plan; throws unless 201. */
export const addLine = async (...args: Parameters<typeof postLine>): Promise<PlanDto> => {
  const response = await postLine(...args);
  if (response.status !== 201) throw new Error(`line failed with status ${response.status}`);
  return (await response.json()) as PlanDto;
};

/** The line of `plan` named `name`; throws when there is none. */
export const lineNamed = (plan: PlanDto, name: string): LineDto => {
  const line = plan.lines.find((l) => l.name === name);
  if (!line) throw new Error(`no line named ${name}`);
  return line;
};

/**
 * Spec section 4 in Household: capacities Ana 1,600,000 and Juan 2,400,000 COP and the lines Rent (SHARED_FUND),
 * Home, Savings (SAVINGS, into Ana's "Ahorros" account) and Free, all RESET and PROPORTIONAL; no catch-all yet.
 */
export const referencePlan = async () => {
  const h = await household();
  const savings = await newAccount(h.ana.personal, "Ahorros", 0, "SAVINGS");
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  await setCapacities(h.ana, h.spaceId, planId, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const add = (line: LineSpec) => addLine(h.ana, h.spaceId, planId, { rolloverMode: "RESET", ...line });
  await add({ name: "Rent", pesos: 1_200_000, funding: "SHARED_FUND" });
  await add({ name: "Home", pesos: 1_470_000, funding: "DIRECT" });
  await add({ name: "Savings", pesos: 600_000, funding: "SAVINGS", savingsAccountIds: [savings] });
  const plan = await add({ name: "Free", pesos: 730_000, funding: "DIRECT" });
  return { h, savings, planId, plan, lineId: (name: string) => lineNamed(plan, name).id };
};

/** HU-E6-03, HU-E6-04: `user` changes the line; `pesos` becomes `plannedAmount`. */
export const patchLine = (
  user: TestUser,
  spaceId: string,
  planId: string,
  lineId: string,
  changes: Partial<LineSpec>,
  version?: number,
) => {
  const { pesos, ...fields } = changes;
  return call(patchLineRoute, "PATCH", plansPath(spaceId, `/${planId}/lines/${lineId}`), {
    user,
    params: { spaceId, planId, lineId },
    body: pesos === undefined ? fields : { ...fields, plannedAmount: cop(pesos) },
    headers: ifMatch(version),
  });
};

/** HU-E6-03, D8: `user` removes the line (logically). */
export const deleteLine = (
  user: TestUser,
  spaceId: string,
  planId: string,
  lineId: string,
  version?: number,
) =>
  call(deleteLineRoute, "DELETE", plansPath(spaceId, `/${planId}/lines/${lineId}`), {
    user,
    params: { spaceId, planId, lineId },
    headers: ifMatch(version),
  });
