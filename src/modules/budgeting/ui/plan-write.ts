import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";

/** Ruling P206: a plan write's outcome: the plan as it now is, or the problem and the lines it names. */
export type PlanWrite =
  | { readonly ok: true; readonly plan: BudgetPlanDto }
  | { readonly ok: false; readonly problem: Problem; readonly lineIds: readonly string[] };

/** `If-Match` with the version of the plan the screen shows (spec 7, HU-E0-10). */
export const ifMatch = (plan: Pick<BudgetPlanDto, "version">): { "if-match": string } => ({
  "if-match": `"${plan.version}"`,
});

/** HU-E6-07: activation's InvalidAllocation names its lines in `lineIds`, a field `Problem` does not keep. */
const lineIdsOf = (error: unknown): string[] => {
  const ids =
    typeof error === "object" && error !== null ? (error as { lineIds?: unknown }).lineIds : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
};

/** Every plan write answers the whole plan; a failure never throws to the screen. */
export const planWrite = async (
  call: Promise<{ data?: BudgetPlanDto; error?: unknown; response: Response }>,
): Promise<PlanWrite> => {
  try {
    const { data, error, response } = await call;
    if (response.ok && data !== undefined) return { ok: true, plan: data };
    return { ok: false, problem: problemFrom(error, response), lineIds: lineIdsOf(error) };
  } catch (error) {
    return { ok: false, problem: problemFrom(error, undefined), lineIds: [] };
  }
};

/** The plan as the server has it now (after a 412, ruling P206); null when it cannot be read. */
export const rereadPlan = async (
  api: Api,
  spaceId: string,
  planId: string,
): Promise<BudgetPlanDto | null> => {
  try {
    const { data } = await api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", {
      params: { path: { spaceId, planId } },
    });
    return data ?? null;
  } catch {
    return null;
  }
};
