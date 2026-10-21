"use client";

import { useTranslations } from "next-intl";
import { useState, type MouseEvent } from "react";
import { Button, ChoiceGroup, Sheet, TextField } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { CategoryIcon } from "./category-icon";
import { activeTree, categoryPath, matches } from "./category-tree";

export type CategoryChoice = { categoryId: string; subcategoryId: string | null } | null;

export interface CategoryPickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groups: readonly CategoryGroupDto[];
  readonly value: CategoryChoice;
  readonly onChoose: (choice: CategoryChoice) => void;
  readonly title?: string;
}

/** The id of the radio a click landed on: a tap on the option already chosen still counts. */
const tappedValue = (event: MouseEvent) =>
  (event.target as HTMLElement).closest("[role='radio']")?.getAttribute("value") ?? null;

/**
 * HU-E9-03, the CategoryPicker artboard: live groups with their categories as chips; a category with subcategories
 * shows them in the same sheet, "No subcategory" first and preselected. No create, edit or Manage (ruling P126).
 */
export function CategoryPicker({ open, onOpenChange, groups, value, onChoose, title }: CategoryPickerProps) {
  const t = useTranslations("categories.picker");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title ?? t("title")}>
      {/* The sheet's content mounts on open, so the draft below starts from `value` each time. */}
      <PickerBody groups={groups} value={value} onChoose={onChoose} close={() => onOpenChange(false)} />
    </Sheet>
  );
}

function PickerBody({
  groups,
  value,
  onChoose,
  close,
}: Pick<CategoryPickerProps, "groups" | "value" | "onChoose"> & { readonly close: () => void }) {
  const t = useTranslations("categories.picker");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<CategoryChoice>(value);
  const live = activeTree(groups);
  const shown = live
    .map((g) => ({ ...g, categories: g.categories.filter((c) => matches(c.name, query)) }))
    .filter((g) => g.categories.length > 0);
  const nodeOf = (id: string) => live.flatMap((g) => g.categories).find((c) => c.id === id);
  const chosen = draft ? (nodeOf(draft.categoryId) ?? null) : null;
  const subcategories = chosen?.subcategories ?? [];
  const pick = (categoryId: string) => {
    const found = nodeOf(categoryId);
    if (!found) return;
    if (found.subcategories.length === 0) {
      onChoose({ categoryId, subcategoryId: null });
      close();
    } else if (draft?.categoryId !== categoryId) setDraft({ categoryId, subcategoryId: null });
  };
  const confirm = () => {
    onChoose(draft);
    close();
  };
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="category-search"
        label={t("search")}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("noMatch", { query: query.trim() })}</p>
      ) : (
        shown.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="flex flex-col gap-2">
            <h3 id={`group-${group.id}`} className="flex items-center gap-2 text-sm font-semibold text-muted">
              <CategoryIcon icon={group.icon} color={group.color} size={24} />
              {group.name}
            </h3>
            <div
              onClick={(event) => {
                const id = tappedValue(event);
                if (id) pick(id);
              }}
            >
              <ChoiceGroup
                label={group.name}
                layout="chips"
                value={draft?.categoryId ?? ""}
                onValueChange={() => undefined}
                options={group.categories.map((c) => ({
                  value: c.id,
                  label: (
                    <span className="flex items-center gap-2 py-1">
                      <CategoryIcon icon={c.icon} color={c.color} size={28} />
                      {c.name}
                    </span>
                  ),
                }))}
              />
            </div>
          </section>
        ))
      )}
      {chosen && subcategories.length > 0 ? (
        <ChoiceGroup
          label={t("subcategoriesOf", { name: chosen.name })}
          layout="chips"
          value={draft?.subcategoryId ?? ""}
          onValueChange={(sub) => setDraft({ categoryId: chosen.id, subcategoryId: sub || null })}
          options={[
            { value: "", label: t("none") },
            ...subcategories.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      ) : null}
      {draft && subcategories.length > 0 ? (
        <Button size="lg" onClick={confirm}>
          {t("use", { path: categoryPath(live, draft.subcategoryId ?? draft.categoryId) ?? "" })}
        </Button>
      ) : null}
    </div>
  );
}
