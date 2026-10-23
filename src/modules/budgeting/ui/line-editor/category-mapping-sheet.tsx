"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Sheet, TextField } from "@/shared/ui";
import type { BudgetPlanDto, CategoryGroupDto } from "@/shared/ui/api/dto";
import { activeTree, CategoryIcon, matches } from "@/modules/categories/ui";

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
  const done = () => {
    onChange(tree.flatMap((group) => group.categories.filter((c) => selected.has(c.id)).map((c) => c.id)));
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { line: lineName })}
      footer={
        <Button size="lg" onClick={done}>
          {t("done")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <TextField
          id={`${ids}-search`}
          label={t("search")}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {shown.map((group) => (
          <fieldset key={group.id} className="flex flex-col">
            <legend className="mb-1 text-sm font-medium [overflow-wrap:anywhere] text-muted">
              {group.name}
            </legend>
            {group.categories.map((category) => {
              const other = lineOf(category.id);
              const noteId = `${ids}-${category.id}-in`;
              return (
                <div key={category.id} className="flex min-h-11 items-center gap-3">
                  <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-base text-ink">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-accent"
                      checked={selected.has(category.id)}
                      disabled={other !== undefined}
                      aria-describedby={other !== undefined ? noteId : undefined}
                      onChange={(event) => toggle(category.id, event.target.checked)}
                    />
                    <CategoryIcon icon={category.icon} color={category.color} size={32} />
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
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Sheet>
  );
}
