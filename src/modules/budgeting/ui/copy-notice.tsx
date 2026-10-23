"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { findCategory } from "@/modules/categories/ui";
import type { BudgetPlanDto, CategoryGroupDto } from "@/shared/ui/api/dto";

export type PlanDrops = NonNullable<BudgetPlanDto["dropped"]>;
const keyOf = (planId: string) => `hearth.planCopy.${planId}`;

/** Ruling P209: what a copy left out travels to the planner once, in this tab only. */
export const rememberDropped = (planId: string, dropped: PlanDrops): void => {
  try {
    globalThis.sessionStorage.setItem(keyOf(planId), JSON.stringify(dropped));
  } catch {
    // Storage blocked or full: the planner shows no notice, which loses only information.
  }
};

export const takeDropped = (planId: string): PlanDrops | null => {
  try {
    const text = globalThis.sessionStorage.getItem(keyOf(planId));
    globalThis.sessionStorage.removeItem(keyOf(planId));
    return text === null ? null : (JSON.parse(text) as PlanDrops);
  } catch {
    return null;
  }
};

/** HU-E6-06, the CopyPlan artboard: the copy's notice, naming what no longer fits by its current names. */
export function CopyNotice({
  plan,
  groups,
}: {
  readonly plan: BudgetPlanDto;
  readonly groups: CategoryGroupDto[];
}) {
  const t = useTranslations("budgeting.copy");
  const [dropped, setDropped] = useState<PlanDrops | null>(null);
  useEffect(() => {
    // sessionStorage exists only in the browser, after hydration. The read removes the entry, so React's second run
    // of this effect in development finds nothing: it must keep what the first run took.
    const taken = takeDropped(plan.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (taken !== null) setDropped(taken);
  }, [plan.id]);
  if (dropped === null) return null;
  const lineName = (id: string) => plan.lines.find((line) => line.id === id)?.name ?? "";
  const items = [
    ...dropped.mappings.map((mapping) =>
      t("droppedMapping", {
        category: findCategory(groups, mapping.categoryId)?.category.name ?? "",
        line: lineName(mapping.lineId),
      }),
    ),
    ...dropped.savingsAccounts.map((account) => t("droppedAccount", { line: lineName(account.lineId) })),
    ...dropped.lines.map((line) => t("droppedLine", { name: line.name })),
  ];
  return (
    <div role="status" className="flex flex-col gap-2 rounded-2xl bg-accent-soft p-4 text-sm text-ink">
      <p className="font-semibold">{t("title")}</p>
      <p>{items.length > 0 ? t("body") : t("bodyComplete")}</p>
      {items.length > 0 ? (
        <ul className="list-disc pl-5 [overflow-wrap:anywhere]">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
