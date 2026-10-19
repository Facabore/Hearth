import { placeIn, treeById, type TreeCategory } from "./category-tree";
import type { CategoryConsumption } from "./unified-view";

/** A space a personal row keeps apart, so the web UI writes "space / group" (HU-E9-11). */
export interface SpaceRef {
  readonly id: string;
  readonly name: string;
}

/** What every node of a breakdown carries (HU-E7-06). */
interface SpendingNode {
  readonly archived: boolean;
  /** The node's space in the personal breakdown when it does not merge across spaces; null otherwise (P76). */
  readonly space: SpaceRef | null;
  readonly total: bigint;
  /** Basis points of the parent's total, rounded half up on each level (ruling P75). */
  readonly share: number;
}

/**
 * A subcategory of a category, or (`subcategoryId` and `name` null) what was spent in the category itself, which is
 * never `archived`: the category row above it carries that flag (ruling P103).
 */
export interface SubcategorySpending extends SpendingNode {
  readonly subcategoryId: string | null;
  readonly name: string | null;
}

export interface CategorySpending extends SpendingNode {
  /** Null for a personal row merged by catalog key (ruling P76). */
  readonly id: string | null;
  readonly key: string | null;
  readonly name: string;
  readonly subcategories: readonly SubcategorySpending[];
}

export interface GroupSpending extends SpendingNode {
  /** Null for a personal row merged by catalog key (ruling P76). */
  readonly id: string | null;
  readonly key: string | null;
  readonly name: string;
  readonly categories: readonly CategorySpending[];
}

export interface SpendingTree {
  /** Σ the groups listed. */
  readonly total: bigint;
  /** Largest first at every level; nodes without spending are left out (ruling P75). */
  readonly groups: readonly GroupSpending[];
}

/**
 * HU-E7-06: a space's own breakdown keeps every node apart; the personal one merges seeded groups and categories of
 * every space by catalog key and gives the other rows their space, named by `spaceNames` (rulings P76, P77).
 */
export type Grouping =
  | { readonly kind: "SPACE" }
  | {
      readonly kind: "PERSONAL";
      readonly personalSpaceId: string;
      readonly spaceNames: ReadonlyMap<string, string>;
    };

/** Basis points of `part` in `whole`, rounded half up (amounts are never negative); 0 of nothing. */
export const shareOf = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 20_000n + whole) / (2n * whole));

/** One space's part of a row: the name and archived flag the row has there, and what was spent there. */
interface Part {
  readonly name: string | null;
  readonly archived: boolean;
  amount: bigint;
}

/** A row being summed: a group, a category or a subcategory entry. */
interface Row {
  readonly id: string | null;
  readonly key: string | null;
  /** The space of a row that does not merge across spaces. */
  readonly spaceId: string | null;
  readonly parts: Map<string, Part>;
  readonly children: Map<string, Row>;
  total: bigint;
}

const rowAt = (rows: Map<string, Row>, at: string, fresh: Pick<Row, "id" | "key" | "spaceId">): Row => {
  const found = rows.get(at);
  if (found !== undefined) return found;
  const row: Row = { ...fresh, parts: new Map(), children: new Map(), total: 0n };
  rows.set(at, row);
  return row;
};

const add = (row: Row, spaceId: string, name: string | null, archived: boolean, amount: bigint): void => {
  row.total += amount;
  const part = row.parts.get(spaceId);
  if (part === undefined) row.parts.set(spaceId, { name, archived, amount });
  else part.amount += amount;
};

/** Case ignored, accents not, as `ListCategories` sorts names (ruling P82). */
const compareText = (a: string, b: string): number => a.localeCompare(b, "es", { sensitivity: "accent" });
const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Total descending; then the entry without a subcategory last, name, space name and id (rulings P75, P82). */
const ordered = <
  T extends { readonly name: string | null; readonly space: SpaceRef | null; readonly total: bigint },
>(
  nodes: T[],
  idOf: (node: T) => string,
): T[] =>
  nodes.sort((a, b) =>
    a.total !== b.total
      ? a.total > b.total
        ? -1
        : 1
      : (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
        compareText(a.name ?? "", b.name ?? "") ||
        compareText(a.space?.name ?? "", b.space?.name ?? "") ||
        ordinal(idOf(a), idOf(b)),
  );

/**
 * HU-E7-06, spec 5.4: `rows` (spending per space and category) by group, category and subcategory of the trees as they
 * stand now. An expense counts in `rollUp(categoryId)` and under the group that category sits in (HU-E3-04, HU-E3-02).
 */
export const spendingTree = (
  rows: readonly CategoryConsumption[],
  nodes: readonly TreeCategory[],
  grouping: Grouping,
): SpendingTree => {
  const tree = treeById(nodes);
  const merges = grouping.kind === "PERSONAL";
  const spaceName = (spaceId: string): string =>
    grouping.kind === "PERSONAL" ? (grouping.spaceNames.get(spaceId) ?? "") : "";
  const groups = new Map<string, Row>();
  for (const { categoryId, amount } of rows) {
    const place = placeIn(tree, categoryId);
    if (place === null || amount === 0n) continue;
    const { category, subcategory } = place;
    const { spaceId } = category;
    const groupMerges = merges && category.groupKey !== null;
    const group = rowAt(groups, groupMerges ? `key/${category.groupKey}` : `id/${category.groupId}`, {
      id: groupMerges ? null : category.groupId,
      key: category.groupKey,
      spaceId: groupMerges ? null : spaceId,
    });
    add(group, spaceId, category.groupName, category.groupArchived, amount);
    // Ruling P102: only a keyed category inside a merged group row merges; a custom group belongs to one space.
    const categoryMerges = groupMerges && category.categoryKey !== null;
    const row = rowAt(
      group.children,
      categoryMerges ? `key/${category.categoryKey}` : `id/${category.categoryId}`,
      {
        id: categoryMerges ? null : category.categoryId,
        key: category.categoryKey,
        spaceId: categoryMerges ? null : spaceId,
      },
    );
    add(row, spaceId, category.categoryName, category.categoryArchived, amount);
    // Subcategories never merge (no catalog key, HU-E3-04); what was spent in the category itself is one entry.
    const entry = rowAt(row.children, subcategory === null ? "direct" : `id/${subcategory.categoryId}`, {
      id: subcategory?.categoryId ?? null,
      key: null,
      spaceId: subcategory === null ? null : spaceId,
    });
    add(entry, spaceId, subcategory?.categoryName ?? null, subcategory?.categoryArchived ?? false, amount);
  }

  // Ruling P76: a merged row takes the name it has in the caller's personal space, even without spending there.
  const own = grouping.kind === "PERSONAL" ? nodes.filter((n) => n.spaceId === grouping.personalSpaceId) : [];
  const groupNames = new Map(
    own.flatMap((n) => (n.groupKey === null ? [] : [[n.groupKey, n.groupName] as const])),
  );
  // Ruling P101: only a top-level category lends its name; a seeded one moved under another keeps its key (spec 5.2)
  // yet counts in its parent, so it never names the row of its key.
  const categoryNames = new Map(
    own.flatMap((n) =>
      n.categoryKey === null || n.parentCategoryId !== null ? [] : [[n.categoryKey, n.categoryName] as const],
    ),
  );
  /** The part with the most spending, ties by space name, then id: where a merged row is named otherwise. */
  const largest = (row: Row): Part =>
    [...row.parts.entries()].sort(([a, x], [b, y]) =>
      x.amount !== y.amount
        ? x.amount > y.amount
          ? -1
          : 1
        : compareText(spaceName(a), spaceName(b)) || ordinal(a, b),
    )[0]![1];
  const nameOf = (row: Row, names: ReadonlyMap<string, string>): string =>
    (row.id === null && row.key !== null ? names.get(row.key) : undefined) ?? largest(row).name ?? "";
  const node = (row: Row, parentTotal: bigint) => ({
    // Ruling P81: a merged row is archived only where every space spending in it archived it.
    archived: [...row.parts.values()].every((part) => part.archived),
    space: merges && row.spaceId !== null ? { id: row.spaceId, name: spaceName(row.spaceId) } : null,
    total: row.total,
    share: shareOf(row.total, parentTotal),
  });
  const subcategoriesOf = (category: Row): SubcategorySpending[] => {
    const entries = [...category.children.values()];
    // A category without spending in a subcategory lists none, not one entry for its own spending (ruling P75).
    if (entries.every((entry) => entry.id === null)) return [];
    return ordered(
      entries.map((entry) => ({
        subcategoryId: entry.id,
        name: entry.id === null ? null : largest(entry).name,
        ...node(entry, category.total),
      })),
      (entry) => entry.subcategoryId ?? "",
    );
  };

  const total = [...groups.values()].reduce((sum, group) => sum + group.total, 0n);
  return {
    total,
    groups: ordered(
      [...groups.values()].map((group) => ({
        id: group.id,
        key: group.key,
        name: nameOf(group, groupNames),
        ...node(group, total),
        categories: ordered(
          [...group.children.values()].map((category) => ({
            id: category.id,
            key: category.key,
            name: nameOf(category, categoryNames),
            ...node(category, group.total),
            subcategories: subcategoriesOf(category),
          })),
          (category) => category.id ?? category.key ?? "",
        ),
      })),
      (group) => group.id ?? group.key ?? "",
    ),
  };
};
