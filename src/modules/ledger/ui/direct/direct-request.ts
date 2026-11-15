import { findCategory, type CategoryChoice } from "@/modules/categories/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";

export type DirectChoice =
  | { readonly kind: "MEMBER"; readonly memberId: string }
  | { readonly kind: "GUEST"; readonly displayName: string };

/** D11, ruling P172: a category travels to the direct space by its catalog key; a person's own has none. */
export const categoryKeyOf = (groups: readonly CategoryGroupDto[], choice: CategoryChoice): string | null => {
  if (choice === null) return null;
  const sub = choice.subcategoryId ? findCategory(groups, choice.subcategoryId)?.category.key : null;
  return sub ?? findCategory(groups, choice.categoryId)?.category.key ?? null;
};

/**
 * `POST /api/v1/direct-splits`: the expense's fields with the counterpart and the key in place of the category id, and
 * (P331) the parts of whom it was for, when they are not Tú and one person in equal parts.
 */
export const directBodyOf = (
  body: Record<string, unknown>,
  choice: DirectChoice,
  categoryKey: string,
  parts?: unknown,
  paidBy?: "COUNTERPART",
): Record<string, unknown> => {
  // P333: the counterpart paid with their own money, so no account of the recorder's goes.
  const dropped = paidBy === undefined ? ["categoryId"] : ["categoryId", "accountId"];
  return {
    ...Object.fromEntries(Object.entries(body).filter(([field]) => !dropped.includes(field))),
    counterpart:
      choice.kind === "MEMBER"
        ? { kind: "MEMBER", memberId: choice.memberId }
        : { kind: "GUEST", displayName: choice.displayName.trim() },
    categoryKey,
    ...(parts === undefined ? {} : { parts }),
    ...(paidBy === undefined ? {} : { paidBy }),
  };
};
