import type { TreeCategory } from "../domain/category-tree";

/** HU-E7-06: the category trees of spaces as they stand now; the composition root binds the categories module. */
export interface CategoryTrees {
  /**
   * Every category and subcategory of `spaceIds` that is not deleted (D8), archived ones included (HU-E3-03), with
   * the group it sits in now and both catalog keys; `[]` without well-formed ids.
   */
  treesOf(spaceIds: readonly string[]): Promise<readonly TreeCategory[]>;
}
