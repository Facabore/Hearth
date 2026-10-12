import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Category, CategoryGroup } from "../domain/category";

/** The parent group; naming a category as the parent would create a third level (HU-E3-02). */
export const groupById = (
  groups: readonly CategoryGroup[],
  categories: readonly Category[],
  groupId: string,
): Result<CategoryGroup> => {
  const group = groups.find((g) => g.id === groupId);
  if (group) return ok(group);
  return err(
    domainError(categories.some((c) => c.id === groupId) ? "CategoryDepthExceeded" : "CategoryGroupNotFound"),
  );
};

export const categoryById = (categories: readonly Category[], categoryId: string): Result<Category> => {
  const category = categories.find((c) => c.id === categoryId);
  return category ? ok(category) : err(domainError("CategoryNotFound"));
};
