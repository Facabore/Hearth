import { POST as createPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/route";
import { call, type TestUser } from "./app";
import type { MoneyDto } from "./ledger";

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
