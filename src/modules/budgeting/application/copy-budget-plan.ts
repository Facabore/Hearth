import { addDays, domainError, err, ok, type Result } from "@/shared/kernel";
import { mappable } from "../domain/category-rollup";
import { copiedParts, type CopyDrops } from "../domain/plan-copy";
import { openedPlan, type NewPlanInput } from "./create-budget-plan";
import type { BudgetingDeps } from "./deps";
import { copyableSavingsAccounts } from "./line-checks";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type {
  AllocationRepository,
  BudgetLineRepository,
  CapacityRepository,
  CategoryMappingRepository,
} from "./ports";

/** HU-E6-06: the copy, and what it left out (ruling P11). */
export interface PlanCopy {
  readonly view: BudgetPlanView;
  readonly dropped: CopyDrops;
}

export type CopyBudgetPlan = (input: NewPlanInput) => Promise<Result<PlanCopy>>;

export type CopyDeps = BudgetingDeps & {
  readonly capacities: CapacityRepository;
  readonly lines: BudgetLineRepository;
  readonly mappings: CategoryMappingRepository;
  readonly allocations: AllocationRepository;
};

/**
 * HU-E6-06: an OWNER or ADMIN creates the DRAFT plan for `period` as a copy of the plan of the previous period of
 * the space's policy: the plan covering the day before the new period starts, so "2026-11 H2" copies "2026-11 H1",
 * never simply the previous calendar month. The source is read FOR SHARE (ruling P14): a write to it in progress
 * ends first and none starts until the copy commits, so the copy reads one committed version of it.
 */
export const createCopyBudgetPlan =
  (deps: CopyDeps): CopyBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const opened = await openedPlan(deps, input);
      if (!opened.ok) return opened;
      const { space } = opened.value;
      const { label, start } = opened.value.plan.period;
      const source = await deps.plans.covering(space.spaceId, addDays(start, -1), { share: true });
      if (source === null) return err(domainError("NoPreviousPlan", { label }));
      const plan = { ...opened.value.plan, createdFrom: source.id };
      // budget_plans_space_start_uq decides a concurrent creation or copy of the same period.
      if (!(await deps.plans.add(plan))) return err(domainError("PlanAlreadyExists", { label }));
      const members = await deps.members.listCurrent(space.spaceId);
      const parts = await deps.plans.contents(source.id);
      const at = deps.clock.now();
      const copy = copiedParts({
        planId: plan.id,
        now: at,
        source: parts,
        lineIds: parts.lines.map(() => deps.ids.next<"BudgetLine">()),
        memberIds: members.map((m) => m.id),
        // HU-E3-04, ruling P48: a mapping of a category that became a subcategory is dropped like an archived one.
        categories: mappable(await deps.categories.list(space.spaceId)),
        usableAccountIds: await copyableSavingsAccounts(
          deps.savingsAccounts,
          { members, spaceCurrency: space.currency },
          parts.lines.flatMap((line) => line.savingsAccountIds),
        ),
      });
      await deps.capacities.setCapacities(plan.id, copy.parts.capacities, at);
      for (const line of copy.parts.lines) {
        await deps.lines.addLine(line, at);
        const categoryIds = copy.parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId);
        if (categoryIds.length > 0) await deps.mappings.mapCategories(plan.id, line.id, categoryIds, at);
        const values = copy.parts.allocations
          .filter((a) => a.lineId === line.id)
          .map(({ memberId, value }) => ({ memberId, value }));
        if (values.length > 0) {
          await deps.allocations.setAllocation(plan.id, line.id, line.allocationRule, values, at);
        }
      }
      return ok({ view: await loadPlanView(deps, space, plan), dropped: copy.dropped });
    });
