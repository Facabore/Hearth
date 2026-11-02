"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Icon, Sheet } from "@/shared/ui";
import type { BudgetPlanDto, CategoryGroupDto } from "@/shared/ui/api/dto";
import { activeTree, matches } from "@/modules/categories/ui";

/**
 * HU-E9-08, ruling P212: a sheet of checkboxes over the live parent categories of the space. A subcategory follows
 * its parent (HU-E3-04), so it is never offered; a category another line of the plan maps is disabled and names that
 * line. "Done" hands back the chosen ones in the tree's order, and archived ones the line still had are left out.
 */
export function CategoryMappingSheet({
  open,
  onOpenChange,
  groups,
  plan,
  lineId,
  lineName,
  value,
  onChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly CategoryGroupDto[];
  readonly plan: BudgetPlanDto;
  /** The line being edited; null for a new one, which no line of the plan has yet. */
  readonly lineId: string | null;
  readonly lineName: string;
  readonly value: readonly string[];
  readonly onChange: (categoryIds: string[]) => void;
}) {
  const t = useTranslations("budgeting.mapping");
  const ids = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(value));
  const [query, setQuery] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts from the line's categories with an empty search, not from what was left behind.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(new Set(value));
      setQuery("");
    }
  }

  const tree = activeTree(groups);
  const shown = tree
    .map((group) => ({ ...group, categories: group.categories.filter((c) => matches(c.name, query)) }))
    .filter((group) => group.categories.length > 0);
  const lineOf = (categoryId: string) =>
    plan.lines.find((other) => other.id !== lineId && other.categoryIds.includes(categoryId));

  const toggle = (categoryId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  const chosen = tree.flatMap((group) => group.categories.filter((c) => selected.has(c.id)).map((c) => c.id));
  const done = () => {
    onChange(chosen);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { line: lineName })}
      footer={
        // Board 06: how many are chosen, beside Listo.
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-base font-semibold text-ink">
            {t("chosen", { count: chosen.length })}
          </p>
          <Button size="md" className="min-w-40" onClick={done}>
            {t("done")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <div className="relative">
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
          />
          <input
            id={`${ids}-search`}
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-12 w-full rounded-xl border border-field bg-bg pr-4 pl-11 text-base text-ink placeholder:text-muted"
          />
        </div>
        {/* Board 06: each group's name over a card of rows, a checkbox and the category's name. */}
        {shown.map((group) => (
          <fieldset key={group.id} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium [overflow-wrap:anywhere] text-muted">
              {group.name}
            </legend>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {group.categories.map((category) => {
                const other = lineOf(category.id);
                const noteId = `${ids}-${category.id}-in`;
                return (
                  <li key={category.id} className="flex min-h-12 items-center gap-3 px-4">
                    <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 text-base font-medium text-ink has-[:disabled]:cursor-default has-[:disabled]:font-normal has-[:disabled]:text-muted">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-accent"
                        checked={selected.has(category.id)}
                        disabled={other !== undefined}
                        aria-describedby={other !== undefined ? noteId : undefined}
                        onChange={(event) => toggle(category.id, event.target.checked)}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{category.name}</span>
                    </label>
                    {other !== undefined ? (
                      <span
                        id={noteId}
                        className="max-w-[40%] shrink-0 text-sm text-muted [overflow-wrap:anywhere]"
                      >
                        {t("inOtherLine", { line: other.name })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
    </Sheet>
  );
}
