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
