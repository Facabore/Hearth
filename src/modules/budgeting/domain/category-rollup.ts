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

/**
 * HU-E3-04, ruling P342 (S7): spending per category and currency with each subcategory's amount added to its parent
 * in the same currency, never across currencies; in first-seen order.
 */
export const rolledUpSpendingByCurrency = (
  byCategory: readonly { readonly categoryId: string; readonly currency: string; readonly amount: bigint }[],
  categories: readonly CategoryParent[],
): { categoryId: string; currency: string; amount: bigint }[] => {
  const sums = new Map<string, { categoryId: string; currency: string; amount: bigint }>();
  for (const { categoryId, currency, amount } of byCategory) {
    const into = rolledUpCategory(categoryId, categories);
    const key = `${into} ${currency}`;
    const sum = sums.get(key);
    sums.set(key, { categoryId: into, currency, amount: (sum?.amount ?? 0n) + amount });
  }
  return [...sums.values()];
};
