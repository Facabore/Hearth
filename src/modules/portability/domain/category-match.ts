/**
 * One leading emoji, kept whole: a base pictographic, an optional variation selector or skin-tone modifier, then any
 * ZWJ-joined pictographics (families, professions). D22 allows one emoji as a category icon.
 */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)/u;

/**
 * Splits a Money Manager category name into its leading emoji (the icon) and the rest (the name), as design §2.2 asks.
 * A name without a leading emoji keeps its whole text and a null icon. Surrounding whitespace is trimmed.
 */
export const splitLeadingEmoji = (raw: string): { icon: string | null; name: string } => {
  const trimmed = raw.trim();
  const match = trimmed.match(LEADING_EMOJI);
  if (!match) return { icon: null, name: trimmed };
  return { icon: match[1]!, name: trimmed.slice(match[1]!.length).trim() };
};

export type CatalogMatch =
  | { readonly kind: "catalog"; readonly catalogKey: string }
  | { readonly kind: "new"; readonly groupKey: string };

/**
 * Design §2.2: each of Money Manager's built-in categories, matched by its English name once the emoji is gone, to a
 * Hearth catalog key. Names not in this table are created new in a group the person picks (Otros by default). The two
 * "Other" built-ins differ by kind. Spanish built-in names are not matched yet (the sample's were English); see Risk.
 */
const EXPENSE_CATALOG: Readonly<Record<string, string>> = {
  food: "groceries",
  "social life": "going_out",
  pets: "pet_care",
  transport: "public_transport",
  culture: "entertainment",
  household: "home_goods",
  apparel: "clothing",
  beauty: "beauty",
  health: "medical",
  education: "tuition",
  gift: "gifts_given",
};

const INCOME_CATALOG: Readonly<Record<string, string>> = {
  salary: "salary",
  bonus: "salary",
  allowance: "other_income",
  "petty cash": "other_income",
  other: "other_income",
};

/** The catalog category proposed for a top-level Money Manager category (design §2.2). */
export const matchCatalog = (name: string, kind: "INCOME" | "EXPENSE"): CatalogMatch => {
  const key = name.trim().toLowerCase();
  const table = kind === "INCOME" ? INCOME_CATALOG : EXPENSE_CATALOG;
  const catalogKey = table[key];
  return catalogKey ? { kind: "catalog", catalogKey } : { kind: "new", groupKey: "other" };
};
