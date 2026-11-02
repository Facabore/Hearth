import type { CategoryGroupDto } from "@/shared/ui/api/dto";

/**
 * #240 (board E9-10 01): the names of the categories Unbudgeted's spending fell into, in the API's order, from the
 * space's categories, archived ones included. An id the list does not hold is left out; an older API sends none.
 */
export const unbudgetedNamesOf = (
  categoryIds: readonly string[] | undefined,
  groups: readonly CategoryGroupDto[] | undefined,
): string[] => {
  if (!categoryIds?.length || !groups) return [];
  const names = new Map<string, string>();
  for (const category of groups.flatMap((group) => group.categories)) {
    names.set(category.id, category.name);
    for (const sub of category.subcategories) names.set(sub.id, sub.name);
  }
  return categoryIds.flatMap((id) => {
    const name = names.get(id);
    return name === undefined ? [] : [name];
  });
};
