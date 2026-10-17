import { ok, type Result } from "@/shared/kernel";
import { checkedMapping } from "../domain/budget-line";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { CategoryMappingRepository } from "./ports";

export type MapCategoriesToLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  categoryIds: readonly string[];
}) => Promise<Result<BudgetPlanView>>;

export type MappingDeps = BudgetingDeps & { readonly mappings: CategoryMappingRepository };

/**
 * HU-E6-04: an OWNER or ADMIN replaces the categories a line consumes. A category maps to one line per plan, newly
 * mapped ones are live, unarchived categories of the plan's space, and those left out are unmapped, never deleted.
 */
export const createMapCategoriesToLine =
  (deps: MappingDeps): MapCategoriesToLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const categories = await deps.categories.list(space.spaceId);
      const categoryIds = checkedMapping(line.value, input.categoryIds, {
        categories,
        mappings: parts.mappings,
      });
      if (!categoryIds.ok) return categoryIds;
      await deps.mappings.mapCategories(plan.id, line.value.id, categoryIds.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
