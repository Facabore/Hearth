import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, PeriodDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";

/**
 * Issue #232 (ruling P283): the period a lifecycle refusal names, with its dates. The refusal carries only the label:
 * SourcePlanOpen names the plan this one was copied from, the period that ends the day before this one starts;
 * CopyAlreadyClosed names its copy, the period that starts the day after this one ends. The space's periods there
 * (stored plan boundaries first) give the dates; null when the label is not the one found or the read fails.
 */
export const problemPeriod = async (
  api: Api,
  spaceId: string,
  plan: Pick<BudgetPlanDto, "period">,
  problem: Problem,
): Promise<PeriodDto | null> => {
  const label = problem.sourcePeriod ?? problem.copyPeriod;
  if (label === undefined) return null;
  const from =
    problem.sourcePeriod !== undefined
      ? addDays(plan.period.startDate as LocalDate, -1)
      : addDays(plan.period.endDate as LocalDate, 1);
  try {
    const { data } = await api.GET("/api/v1/spaces/{spaceId}/periods", {
      params: { path: { spaceId }, query: { from, count: 1 } },
    });
    return data?.items.find((period) => period.label === label) ?? null;
  } catch {
    return null;
  }
};
