"use client";

import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useState, type MouseEvent } from "react";
import {
  activeTree,
  CategoryIcon,
  categoryPath,
  matches,
  type CategoryChoice,
} from "@/modules/categories/ui";
import { ChoiceGroup, Icon } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import type { RecentCategory } from "./recent-categories";

export interface CategorySheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The groups the movement's kind offers; archived ones are never shown. */
  readonly groups: readonly CategoryGroupDto[];
  readonly value: CategoryChoice;
  readonly onChoose: (choice: CategoryChoice) => void;
  /** The recent categories the kind still offers, newest first. */
  readonly recent: readonly RecentCategory[];
}

/** The id of the radio a click landed on: a tap on the option already chosen still counts. */
const tappedValue = (event: MouseEvent) =>
  (event.target as HTMLElement).closest("[role='radio']")?.getAttribute("value") ?? null;

/**
 * Ruling P291 (board B1 · 03): the record form's category picker, a sheet with a way back to the form. A search with
 * a magnifier, the recent categories as chips, and under "Todas" a tile per group that opens its categories in a
 * tinted panel; a category with subcategories asks for one there, "Sin subcategoría" first. A tap chooses and closes.
 * It loads when the form mounts, beside it, never in the form's route (ADR 0004).
 */
export function CategorySheet({ open, onOpenChange, ...body }: CategorySheetProps) {
  const t = useTranslations("categories.picker");
  const common = useTranslations("common");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[95dvh] flex-col rounded-t-[20px] bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:w-full lg:max-w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px]"
        >
          <div aria-hidden="true" className="mx-auto mb-1 h-[5px] w-10 rounded-full bg-track lg:hidden" />
          <div className="flex items-center gap-1">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={common("back")}
                className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink"
              >
                <Icon name="back" />
              </button>
            </Dialog.Close>
            <Dialog.Title className="text-lg font-semibold text-ink">{t("title")}</Dialog.Title>
          </div>
          <div className="mt-2 min-h-0 overflow-y-auto overscroll-contain">
            {/* The content mounts on open, so the panel and the draft start from `value` each time. */}
            <SheetBody {...body} close={() => onOpenChange(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetBody({
  groups,
  value,
  onChoose,
  recent,
  close,
}: Omit<CategorySheetProps, "open" | "onOpenChange"> & { readonly close: () => void }) {
  const t = useTranslations("categories.picker");
  const form = useTranslations("ledger.form");
  const live = activeTree(groups);
  const nodes = live.flatMap((g) => g.categories);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<CategoryChoice>(value);
  const [openGroup, setOpenGroup] = useState(
    () => live.find((g) => g.categories.some((c) => c.id === value?.categoryId))?.id ?? live[0]?.id ?? null,
  );
  const chosen = draft ? (nodes.find((c) => c.id === draft.categoryId) ?? null) : null;
  const choose = (choice: CategoryChoice) => {
    onChoose(choice);
    close();
  };
  // A category without subcategories is the answer; one with them asks for one below, none preselected.
  const pick = (categoryId: string) => {
    const found = nodes.find((c) => c.id === categoryId);
    if (!found) return;
    if (found.subcategories.length === 0) choose({ categoryId, subcategoryId: null });
    else if (draft?.categoryId !== categoryId) setDraft({ categoryId, subcategoryId: null });
  };
  const categoryChips = (label: string, categories: typeof nodes) => (
    <div
      onClick={(event) => {
        const id = tappedValue(event);
        if (id) pick(id);
      }}
    >
      <ChoiceGroup
        label={label}
        layout="chips"
        value={draft?.categoryId ?? ""}
        onValueChange={(id) => setDraft({ categoryId: id, subcategoryId: null })}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
    </div>
  );
  const group = live.find((g) => g.id === openGroup);
  const found = query.trim() === "" ? null : nodes.filter((c) => matches(c.name, query));
  const heading = "text-sm font-medium text-muted";
  // The subcategory step, under the categories it belongs to: any tap on it, "Sin subcategoría" too, is the answer.
  const subStep =
    chosen && chosen.subcategories.length > 0 ? (
      <div
        className="flex flex-col gap-2 border-t border-line pt-2"
        onClick={(event) => {
          const id = tappedValue(event);
          if (id !== null) choose({ categoryId: chosen.id, subcategoryId: id || null });
        }}
      >
        <p className={heading}>{t("optional", { name: chosen.name })}</p>
        <ChoiceGroup
          label={t("subcategoriesOf", { name: chosen.name })}
          layout="chips"
          value={draft?.subcategoryId ?? ""}
          onValueChange={(sub) => setDraft({ categoryId: chosen.id, subcategoryId: sub || null })}
          options={[
            { value: "", label: t("none") },
            ...chosen.subcategories.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
    ) : null;
  // The tinted panel's chips are white, as the board draws them; the chosen one keeps its own tint.
  const panel =
    "flex flex-col gap-2 rounded-2xl bg-track p-3 [&_[role=radio][data-state=unchecked]]:bg-surface";
  return (
    <div className="flex flex-col gap-3">
      <label className="relative flex items-center">
        <span className="sr-only">{t("search")}</span>
        <Icon name="search" size={20} className="pointer-events-none absolute left-3 text-muted" />
        <input
          id="category-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          autoComplete="off"
          className="h-12 w-full rounded-xl bg-track pr-3 pl-10 text-base text-ink placeholder:text-muted"
        />
      </label>
      {found === null ? (
        <>
          {recent.length > 0 ? (
            <section aria-labelledby="category-recent" className="flex flex-col gap-2">
              <h3 id="category-recent" className={heading}>
                {form("recent")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button
                    key={r.subcategoryId ?? r.categoryId}
                    type="button"
                    onClick={() => choose(r)}
                    className="min-h-11 rounded-full border border-line px-4 text-sm font-medium text-ink"
                  >
                    {categoryPath(live, r.subcategoryId ?? r.categoryId)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section aria-labelledby="category-all" className="flex flex-col gap-2">
            <h3 id="category-all" className={heading}>
              {t("all")}
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {live.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-expanded={g.id === openGroup}
                  aria-controls="category-panel"
                  onClick={() => setOpenGroup(g.id)}
                  className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border border-line px-1 py-2 text-xs font-medium text-ink aria-expanded:border-2 aria-expanded:border-accent aria-expanded:bg-accent-soft"
                >
                  <CategoryIcon icon={g.icon} color={g.color} size={32} />
                  <span className="line-clamp-2 text-center [overflow-wrap:anywhere]">{g.name}</span>
                </button>
              ))}
            </div>
            {group ? (
              <div id="category-panel" className={panel}>
                <p className={heading}>{group.name}</p>
                {categoryChips(group.name, group.categories)}
                {chosen && group.categories.includes(chosen) ? subStep : null}
              </div>
            ) : null}
          </section>
        </>
      ) : found.length === 0 ? (
        <p className="text-sm text-muted">{t("noMatch", { query: query.trim() })}</p>
      ) : (
        <div className={panel}>
          {categoryChips(t("search"), found)}
          {subStep}
        </div>
      )}
    </div>
  );
}
