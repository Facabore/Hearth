import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { ifMatch, planWrite, type PlanWrite } from "../plan-write";
import type { LineBody } from "./line-draft";

export type LineSection = "line" | "categories" | "allocation";

/** What one save sends; `null` means "nothing to send" for that step. */
export interface LineSave {
  readonly line: Partial<LineBody> | LineBody | null;
}

export type SaveOutcome =
  | { readonly ok: true; readonly plan: BudgetPlanDto; readonly lineId: string }
  | {
      readonly ok: false;
      readonly plan: BudgetPlanDto;
      readonly section: LineSection;
      readonly problem: Problem;
      readonly lineIds: readonly string[];
    };

/** The line an add created: the one the answer has and the plan before it had not. */
export const newLineId = (before: BudgetPlanDto, after: BudgetPlanDto): string =>
  after.lines.find((line) => !before.lines.some((old) => old.id === line.id))?.id ?? after.lines.at(-1)!.id;

/**
 * Ruling P210: the steps run in order, each only when it has something to send and each with the version the step
 * before answered; the first failure stops the sequence and keeps what was already saved.
 */
export const saveLine = async (
  api: Api,
  { spaceId, plan, lineId }: { spaceId: string; plan: BudgetPlanDto; lineId: string | null },
  save: LineSave,
): Promise<SaveOutcome> => {
  const path = { spaceId, planId: plan.id };
  let current = plan;
  let id = lineId;
  if (save.line !== null && (id === null || Object.keys(save.line).length > 0)) {
    const result: PlanWrite =
      id === null
        ? await planWrite(
            api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/lines", {
              params: { path },
              headers: ifMatch(current),
              body: save.line as LineBody,
            }),
          )
        : await planWrite(
            api.PATCH("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}", {
              params: { path: { ...path, lineId: id } },
              headers: ifMatch(current),
              body: save.line,
            }),
          );
    if (!result.ok)
      return { ok: false, plan: current, section: "line", problem: result.problem, lineIds: result.lineIds };
    id ??= newLineId(current, result.plan);
    current = result.plan;
  }
  return { ok: true, plan: current, lineId: id! };
};

/** HU-E6-03: removing a line (logically, D8), with the plan's version. */
export const removeLine = (
  api: Api,
  { spaceId, plan, lineId }: { spaceId: string; plan: BudgetPlanDto; lineId: string },
): Promise<PlanWrite> =>
  planWrite(
    api.DELETE("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}", {
      params: { path: { spaceId, planId: plan.id, lineId } },
      headers: ifMatch(plan),
    }),
  );
