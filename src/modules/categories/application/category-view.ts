import { shownStyle, type Category } from "../domain/category";
import type { CategoryStyle } from "../domain/category-style";

/** HU-E3-05: a category as answers show it: `shown` is its own style, or a subcategory's parent's. */
export interface CategoryView extends Category {
  readonly shown: CategoryStyle;
}

export const viewOf = (category: Category, categories: readonly Category[]): CategoryView => ({
  ...category,
  shown: shownStyle(category, categories),
});
