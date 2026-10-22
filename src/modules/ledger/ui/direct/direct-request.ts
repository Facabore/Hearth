import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";

export type DirectChoice =
  | { readonly kind: "MEMBER"; readonly memberId: string; readonly name: string }
  | { readonly kind: "GUEST"; readonly displayName: string };

/** D11, ruling P172: a category travels to the direct space by its catalog key; a person's own has none. */
export const categoryKeyOf = (groups: readonly CategoryGroupDto[], choice: CategoryChoice): string | null => {
  if (choice === null) return null;
  const sub = choice.subcategoryId ? findCategory(groups, choice.subcategoryId)?.category.key : null;
  return sub ?? findCategory(groups, choice.categoryId)?.category.key ?? null;
};

/** `POST /api/v1/direct-splits`: the expense's fields with the counterpart and the key in place of the category id. */
export const directBodyOf = (
  body: Record<string, unknown>,
  choice: DirectChoice,
  categoryKey: string,
): Record<string, unknown> => {
  return {
    ...Object.fromEntries(Object.entries(body).filter(([field]) => field !== "categoryId")),
    counterpart:
      choice.kind === "MEMBER"
        ? { kind: "MEMBER", memberId: choice.memberId }
        : { kind: "GUEST", displayName: choice.displayName.trim() },
    categoryKey,
  };
};
