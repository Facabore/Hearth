import type { CategoryGroupDto } from "@/shared/ui/api/dto";

/** A category chosen on the record form; a subcategory carries its parent. */
export interface RecentCategory {
  readonly categoryId: string;
  readonly subcategoryId: string | null;
}

/** Issue #173: how many recent categories the form offers as chips. */
export const RECENT_LIMIT = 6;

const keyOf = (spaceId: string, kind: "EXPENSE" | "INCOME") => `hearth.recentCategories.${spaceId}.${kind}`;
const same = (a: RecentCategory, b: RecentCategory) =>
  a.categoryId === b.categoryId && a.subcategoryId === b.subcategoryId;

/** Issue #173: the stored text of a space's recents for a kind, or null; a blocked storage reads as none. */
export const rawRecent = (
  storage: Storage | undefined,
  spaceId: string,
  kind: "EXPENSE" | "INCOME",
): string | null => {
  try {
    return storage?.getItem(keyOf(spaceId, kind)) ?? null;
  } catch {
    return null;
  }
};

/** The recents a stored text holds, newest first; anything else reads as none. */
export const parseRecent = (raw: string | null): RecentCategory[] => {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentCategory =>
          typeof item?.categoryId === "string" &&
          (item.subcategoryId === null || typeof item.subcategoryId === "string"),
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
};

/**
 * Issue #173: the categories this browser recorded last in a space, newest first. A per-viewer convenience: storage
 * that is missing, blocked or holds something else reads as none.
 */
export const readRecent = (
  storage: Storage | undefined,
  spaceId: string,
  kind: "EXPENSE" | "INCOME",
): RecentCategory[] => parseRecent(rawRecent(storage, spaceId, kind));

/** Puts `chosen` first, drops its older copy and keeps the newest RECENT_LIMIT; a storage that throws is ignored. */
export const rememberRecent = (
  storage: Storage | undefined,
  spaceId: string,
  kind: "EXPENSE" | "INCOME",
  chosen: RecentCategory,
): void => {
  try {
    const next = [chosen, ...readRecent(storage, spaceId, kind).filter((r) => !same(r, chosen))].slice(
      0,
      RECENT_LIMIT,
    );
    storage?.setItem(keyOf(spaceId, kind), JSON.stringify(next));
  } catch {
    // A full or blocked storage only loses the convenience.
  }
};

/** The recents the form may still offer: their category (and subcategory) live in the groups the kind's sheet lists. */
export const offeredRecent = (
  recent: readonly RecentCategory[],
  groups: readonly CategoryGroupDto[],
): RecentCategory[] =>
  recent.filter((r) => {
    const category = groups.flatMap((g) => g.categories).find((c) => c.id === r.categoryId);
    return (
      category !== undefined &&
      (r.subcategoryId === null || category.subcategories.some((s) => s.id === r.subcategoryId))
    );
  });
