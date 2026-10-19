/**
 * HU-E7-06: one category or subcategory of a space where it sits now (HU-E3-02: nothing records a move), archived
 * ones included (HU-E3-03), with the catalog key of its group (HU-E3-05) and its own (D11).
 */
export interface TreeCategory {
  readonly spaceId: string;
  readonly groupId: string;
  /** The seeded group's catalog key; null for groups users create and those the back-fill left without one. */
  readonly groupKey: string | null;
  readonly groupName: string;
  readonly groupArchived: boolean;
  readonly categoryId: string;
  /** The seeded category's catalog key; null for categories users create. A seeded category moved under another keeps it (spec 5.2), yet still counts in its parent. */
  readonly categoryKey: string | null;
  readonly categoryName: string;
  readonly categoryArchived: boolean;
  /** HU-E3-04: the category a subcategory belongs to; null for a category directly in its group. */
  readonly parentCategoryId: string | null;
}

/** Where spending recorded in one category counts: its category, and the subcategory it was recorded in, if any. */
export interface TreePlace {
  readonly category: TreeCategory;
  readonly subcategory: TreeCategory | null;
}

/** The nodes of one or more trees by category id, as `placeIn` reads them. */
export const treeById = (nodes: readonly TreeCategory[]): Map<string, TreeCategory> =>
  new Map(nodes.map((node) => [node.categoryId, node]));

/**
 * HU-E3-04: rollUp(categoryId) = parentCategoryId ?? categoryId, so spending in a subcategory counts in its category
 * and in that category's group (spec 5.4); null for a category the tree does not hold.
 */
export const placeIn = (tree: ReadonlyMap<string, TreeCategory>, categoryId: string): TreePlace | null => {
  const node = tree.get(categoryId);
  if (node === undefined) return null;
  // A subcategory whose parent the tree lacks counts as a category of its own (ruling P48 keeps such a parent).
  const parent = node.parentCategoryId === null ? undefined : tree.get(node.parentCategoryId);
  return parent === undefined
    ? { category: node, subcategory: null }
    : { category: parent, subcategory: node };
};
