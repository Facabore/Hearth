"use client";

import { useTranslations } from "next-intl";
import { CategoryIcon, findCategory, type CategoryChoice } from "@/modules/categories/ui";
import { Icon } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import type { RecentCategory } from "./recent-categories";

/** Board B1 · 01: three category tiles, then the one that opens every category. */
const TILES = 3;

/**
 * The categories the tiles show: the chosen one, then the recent ones, then the first of the kind's tree. The chosen
 * one may be archived since (an edit), so it is named from the whole tree.
 */
export const tileIds = (
  offered: readonly CategoryGroupDto[],
  recent: readonly RecentCategory[],
  chosen: string | null,
): string[] =>
  [
    ...new Set([
      ...(chosen ? [chosen] : []),
      ...recent.map((r) => r.categoryId),
      ...offered.flatMap((g) => g.categories.map((c) => c.id)),
    ]),
  ].slice(0, TILES);

/** Four 2 × 2 squares: "every category". */
function GridIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Ruling P291 (board B1 · 01): the category as a row of tiles, most recent first; the chosen one carries a pencil and
 * a second tap on it opens the picker, as the last tile does. Under them, the chosen category's subcategories as chips:
 * tapping the chosen chip again leaves the category without one.
 */
export function CategoryTiles({
  groups,
  offered,
  recent,
  value,
  onChoose,
  onMore,
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
  readonly error?: string | undefined;
}) {
  const t = useTranslations("ledger.form");
  const picker = useTranslations("categories.picker");
  const ids = tileIds(offered, recent, value?.categoryId ?? null);
  const live = offered.flatMap((g) => g.categories).find((c) => c.id === value?.categoryId);
  const subcategories = live?.subcategories ?? [];
  const tile =
    "relative flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-xs font-medium text-ink";
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("category")}
        aria-describedby={error ? "record-category-error" : undefined}
        className="grid grid-cols-4 gap-2"
      >
        {ids.map((id) => {
          const found = findCategory(groups, id);
          if (!found) return null;
          const chosen = value?.categoryId === id;
          const latest = recent.find((r) => r.categoryId === id)?.subcategoryId ?? null;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={chosen}
              onClick={() => (chosen ? onMore() : onChoose({ categoryId: id, subcategoryId: latest }))}
              className={`${tile} ${chosen ? "border-2 border-accent bg-accent-soft" : "border-line bg-surface"}`}
            >
              <CategoryIcon icon={found.category.icon} color={found.category.color} size={28} />
              <span className="line-clamp-2 text-center [overflow-wrap:anywhere]">{found.category.name}</span>
              {chosen ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-line bg-surface text-accent"
                >
                  <Icon name="pencil" size={14} />
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-label={t("chooseCategory")}
          className={`${tile} border-dashed border-field bg-surface text-accent`}
        >
          <GridIcon />
          <Icon name="chevronDown" size={16} />
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
          {subcategories.map((sub) => {
            const chosen = value?.subcategoryId === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                aria-pressed={chosen}
                onClick={() => onChoose({ categoryId: live.id, subcategoryId: chosen ? null : sub.id })}
                className="flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft"
              >
                {chosen ? <Icon name="check" size={16} className="text-accent" /> : null}
                {sub.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
