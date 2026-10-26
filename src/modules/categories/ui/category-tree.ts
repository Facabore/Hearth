import type { CategoryDto, CategoryGroupDto } from "@/shared/ui/api/dto";

/** HU-E9-03: what a picker offers: archived groups, categories and subcategories are never shown. */
export const activeTree = (groups: readonly CategoryGroupDto[]): CategoryGroupDto[] =>
  groups
    .filter((g) => g.archivedAt === null)
    .map((g) => ({
      ...g,
      categories: g.categories
        .filter((c) => c.archivedAt === null)
        .map((c) => ({ ...c, subcategories: c.subcategories.filter((s) => s.archivedAt === null) })),
    }));

/**
 * Issue #173: the groups a movement of `kind` offers. Groups carry no type, so the catalog's income group (key
 * "income", D11) is the only income one: an expense leaves it out and an income offers only it. A group of the
 * person's own has no key and is offered to both.
 */
export const groupsForKind = (
  groups: readonly CategoryGroupDto[],
  kind: "EXPENSE" | "INCOME",
): CategoryGroupDto[] => groups.filter((g) => g.key === null || (g.key === "income") === (kind === "INCOME"));

/** A category or subcategory anywhere in the tree, archived ones included (old rows still name them). */
export const findCategory = (
  groups: readonly CategoryGroupDto[],
  id: string,
): { category: CategoryDto; parent: CategoryDto | null; group: CategoryGroupDto } | null => {
  for (const group of groups)
    for (const category of group.categories) {
      if (category.id === id) return { category, parent: null, group };
      const sub = category.subcategories.find((s) => s.id === id);
      if (sub) return { category: sub, parent: category, group };
    }
  return null;
};

/** "Groceries › Vegetables" for a subcategory, the name for a parent, null when unknown. */
export const categoryPath = (groups: readonly CategoryGroupDto[], id: string): string | null => {
  const found = findCategory(groups, id);
  if (!found) return null;
  return found.parent ? `${found.parent.name} › ${found.category.name}` : found.category.name;
};

const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Case and accent insensitive: "alimentacion" finds "Alimentación". */
export const matches = (name: string, query: string): boolean => folded(name).includes(folded(query.trim()));

type CategoryNode = CategoryGroupDto["categories"][number];
type SavedCategory = CategoryNode["subcategories"][number];
type SavedGroup = Omit<CategoryGroupDto, "categories">;

/** HU-E9-04: a group `POST /category-groups` answered, last, with no categories yet. */
export const withGroup = (groups: readonly CategoryGroupDto[], group: SavedGroup): CategoryGroupDto[] => [
  ...groups,
  { ...group, categories: [] },
];

/** The tree without the category or subcategory `id` (a delete). */
export const withoutCategory = (groups: readonly CategoryGroupDto[], id: string): CategoryGroupDto[] =>
  groups.map((group) => ({
    ...group,
    categories: group.categories
      .filter((category) => category.id !== id)
      .map((category) => ({
        ...category,
        subcategories: category.subcategories.filter((sub) => sub.id !== id),
      })),
  }));

/**
 * HU-E9-04: the tree once `saved` (what a create, update, archive or restore answered) is where it now lives, so the
 * screen shows it without a reload. A category keeps its place when it stays in its group and moves last into another
 * one, with its subcategories: they follow its group and style (HU-E3-05: theirs is derived), and its archiving.
 * `null` when the tree holds no group (or parent) to put it in, so the caller reads the tree again instead of losing it.
 */
export const withCategory = (
  groups: readonly CategoryGroupDto[],
  saved: SavedCategory,
): CategoryGroupDto[] | null => {
  const home =
    saved.parentCategoryId === null
      ? groups.some((group) => group.id === saved.groupId)
      : groups.some((group) => group.categories.some((c) => c.id === saved.parentCategoryId));
  if (!home) return null;
  const previous = findCategory(groups, saved.id);
  const stays =
    previous !== null &&
    previous.category.groupId === saved.groupId &&
    previous.category.parentCategoryId === saved.parentCategoryId;
  if (saved.parentCategoryId !== null) {
    const rest = stays ? groups : withoutCategory(groups, saved.id);
    return rest.map((group) => ({
      ...group,
      categories: group.categories.map((category) =>
        category.id !== saved.parentCategoryId
          ? category
          : {
              ...category,
              subcategories: stays
                ? category.subcategories.map((s) => (s.id === saved.id ? saved : s))
                : [...category.subcategories, saved],
            },
      ),
    }));
  }
  // `findCategory` types a match as a bare category; its group holds the node with the subcategories.
  const existing =
    previous?.parent === null ? previous.group.categories.find((c) => c.id === saved.id) : undefined;
  const subcategories = (existing?.subcategories ?? []).map((sub) => ({
    ...sub,
    groupId: saved.groupId,
    icon: saved.icon,
    color: saved.color,
    archivedAt: sub.archivedAt ?? saved.archivedAt,
  }));
  const node: CategoryNode = { ...saved, subcategories };
  const rest = stays ? groups : withoutCategory(groups, saved.id);
  return rest.map((group) =>
    group.id !== saved.groupId
      ? group
      : {
          ...group,
          categories: stays
            ? group.categories.map((c) => (c.id === saved.id ? node : c))
            : [...group.categories, node],
        },
  );
};
