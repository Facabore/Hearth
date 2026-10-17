/** HU-E3-04: what budgeting knows of a category's place in the tree; absent or null means directly in its group. */
export interface CategoryParent {
  readonly id: string;
  readonly parentCategoryId?: string | null;
}

/** HU-E3-04, D20: rollUp(categoryId) = parentCategoryId ?? categoryId. */
export const rolledUpCategory = (categoryId: string, categories: readonly CategoryParent[]): string =>
  categories.find((c) => c.id === categoryId)?.parentCategoryId ?? categoryId;

/** HU-E3-04: spending per category with each subcategory's amount added to its parent, in first-seen order. */
export const rolledUpSpending = (
  byCategory: readonly { readonly categoryId: string; readonly amount: bigint }[],
  categories: readonly CategoryParent[],
): { categoryId: string; amount: bigint }[] => {
  const sums = new Map<string, bigint>();
  for (const { categoryId, amount } of byCategory) {
    const into = rolledUpCategory(categoryId, categories);
    sums.set(into, (sums.get(into) ?? 0n) + amount);
  }
  return [...sums].map(([categoryId, amount]) => ({ categoryId, amount }));
};

/** HU-E3-04, ruling P48: only categories directly in their group are mapped to lines. */
export const mappable = <T extends CategoryParent>(categories: readonly T[]): T[] =>
  categories.filter((c) => (c.parentCategoryId ?? null) === null);
