"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import { Icon } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import type { RecentCategory } from "./recent-categories";

/** Board B1 · 01: three category chips, then the one that opens every category. */
const TILES = 3;

/** #289 (audit pass 3, A14): the seeded categories most records fall in, before the tree's order (housing first). */
const EVERYDAY = ["groceries", "restaurants", "public_transport", "salary"];

/**
 * The categories the chips show: the chosen one, then the recent ones, then the everyday seeded ones, then the rest of
 * the kind's tree in its order. The chosen one may be archived since (an edit), so it is named from the whole tree.
 */
export const tileIds = (
  offered: readonly CategoryGroupDto[],
  recent: readonly RecentCategory[],
  chosen: string | null,
): string[] => {
  const tree = offered.flatMap((g) => g.categories);
  return [
    ...new Set([
      ...(chosen ? [chosen] : []),
      ...recent.map((r) => r.categoryId),
      ...EVERYDAY.flatMap((key) => tree.filter((c) => c.key === key).map((c) => c.id)),
      ...tree.map((c) => c.id),
    ]),
  ].slice(0, TILES);
};

/**
 * Ruling P291 (board B1 · 01), drawn as ruling P324 asks (medium density, board "Registrar gasto"): the category as one
 * row of chips, most recent first, then "Todas", which opens every category; a second tap on the chosen chip opens the
 * picker too. Ruling P346: a tap chooses the category alone, and right after the chosen chip, for who manages the tree,
 * a pencil edits it. Under them, the chosen category's subcategories as chips, «Sin subcategoría» first: tapping it, or
 * the chosen subcategory again, leaves the category without one. A chip's name stays on one line, cut short with an
 * ellipsis rather than broken mid-word.
 */
export function CategoryTiles({
  groups,
  offered,
  recent,
  value,
  onChoose,
  onMore,
  onEdit,
  error,
}: {
  /** The whole tree, archived categories included. */
  readonly groups: readonly CategoryGroupDto[];
  /** The live groups the movement's kind offers. */
  readonly offered: readonly CategoryGroupDto[];
  readonly recent: readonly RecentCategory[];
  readonly value: CategoryChoice;
  readonly onChoose: (choice: CategoryChoice) => void;
  readonly onMore: () => void;
  /** P346 (S6): edits the chosen category; without it (a role that does not manage the tree) there is no pencil. */
  readonly onEdit?: ((categoryId: string) => void) | undefined;
  readonly error?: string | undefined;
}) {
  const t = useTranslations("ledger.form");
  const picker = useTranslations("categories.picker");
  const catalog = useTranslations("categories");
  const ids = tileIds(offered, recent, value?.categoryId ?? null);
  const live = offered.flatMap((g) => g.categories).find((c) => c.id === value?.categoryId);
  const subcategories = live?.subcategories ?? [];
  const chip = "flex min-h-11 max-w-full min-w-0 items-center rounded-full border px-3.5 text-sm font-medium";
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("category")}
        aria-describedby={error ? "record-category-error" : undefined}
        className="flex flex-wrap gap-2"
      >
        {ids.map((id) => {
          const found = findCategory(groups, id);
          if (!found) return null;
          const chosen = value?.categoryId === id;
          return (
            <Fragment key={id}>
              <button
                type="button"
                aria-pressed={chosen}
                // P346 (S3): the category alone; the subcategory used with it last is no longer brought back.
                onClick={() => (chosen ? onMore() : onChoose({ categoryId: id, subcategoryId: null }))}
                className={`${chip} ${chosen ? "border-accent-soft bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink"}`}
              >
                {/* #309 (S5): one line, never broken mid-word ("Restaurante/s" at 390 px); a long name ends in "…". */}
                <span className="truncate">{found.category.name}</span>
              </button>
              {chosen && onEdit ? (
                // P346 (S6, S8): a white 44 px circle with a line border, its own target, named for screen readers.
                <button
                  type="button"
                  aria-label={catalog("edit", { name: found.category.name })}
                  onClick={() => onEdit(id)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink"
                >
                  <Icon name="pencil" size={18} />
                </button>
              ) : null}
            </Fragment>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-label={t("chooseCategory")}
          className={`${chip} border-line bg-surface text-ink`}
        >
          <span aria-hidden="true" className="truncate">
            {t("allCategories")}
          </span>
        </button>
      </div>
      {error ? (
        <p id="record-category-error" className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
      {live && subcategories.length > 0 ? (
        <div
          role="group"
          aria-label={picker("subcategoriesOf", { name: live.name })}
          className="flex flex-wrap gap-2 rounded-xl bg-track p-1.5"
        >
          {/* P346 (S4): «Sin subcategoría» first, checked while none is chosen; then the subcategories in order. */}
          <SubcategoryChip
            name={picker("none")}
            chosen={!value?.subcategoryId}
            onClick={() => onChoose({ categoryId: live.id, subcategoryId: null })}
          />
          {subcategories.map((sub) => {
            const chosen = value?.subcategoryId === sub.id;
            return (
              <SubcategoryChip
                key={sub.id}
                name={sub.name}
                chosen={chosen}
                onClick={() => onChoose({ categoryId: live.id, subcategoryId: chosen ? null : sub.id })}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** A chip of the subcategory row: the checked one shows the check icon. */
function SubcategoryChip({
  name,
  chosen,
  onClick,
}: {
  readonly name: string;
  readonly chosen: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      className="flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft"
    >
      {chosen ? <Icon name="check" size={16} className="text-accent" /> : null}
      {name}
    </button>
  );
}
