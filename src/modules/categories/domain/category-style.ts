import {
  domainError,
  err,
  ok,
  PALETTE,
  type PaletteKey,
  type Result,
  type SymbolName,
} from "@/shared/kernel";

/**
 * HU-E3-05, D22: the palette, in the order the color row shows it. The UI maps each key to its light and dark theme
 * tokens; no hex value is stored.
 */
export const CATEGORY_COLORS = PALETTE;
export type CategoryColor = PaletteKey;

/**
 * HU-E3-05: the fixed symbol set, 58 names in alphabetical order. The UI draws each name with its own icon set and
 * groups the names in the nine sections of its icon library; a section is UI metadata and never appears here.
 */
export const CATEGORY_SYMBOLS = [
  "apple",
  "bag",
  "bank",
  "basket",
  "bike",
  "book",
  "bread",
  "briefcase",
  "bulb",
  "bus",
  "calendar",
  "car",
  "card",
  "cart",
  "chart",
  "coins",
  "cross",
  "cup",
  "dots",
  "droplet",
  "flame",
  "fork",
  "fuel",
  "game",
  "gift",
  "globe",
  "graduation",
  "gym",
  "heart",
  "home",
  "key",
  "laptop",
  "leaf",
  "music",
  "parking",
  "paw",
  "percent",
  "phone",
  "piggy",
  "pill",
  "pizza",
  "plane",
  "receipt",
  "scissors",
  "shield",
  "shirt",
  "sofa",
  "star",
  "tag",
  "ticket",
  "tooth",
  "train",
  "tv",
  "umbrella",
  "users",
  "wifi",
  "wine",
  "wrench",
] as const satisfies readonly SymbolName[];
export type CategorySymbol = (typeof CATEGORY_SYMBOLS)[number];

export type CategoryIcon =
  | { readonly kind: "SYMBOL"; readonly name: CategorySymbol }
  | { readonly kind: "EMOJI"; readonly value: string };

/** An icon as a request sends it, before `categoryIconOf` checks it. */
export type IconInput =
  { readonly kind: "SYMBOL"; readonly name: string } | { readonly kind: "EMOJI"; readonly value: string };

export interface CategoryStyle {
  readonly icon: CategoryIcon;
  readonly color: CategoryColor;
}

/** What a create or an update changes; a part left out keeps the current (or copied) one. */
export interface StyleChange {
  readonly icon?: CategoryIcon;
  readonly color?: CategoryColor;
}

/** HU-E3-05: the style of a group created without one, and of the custom groups that existed before 0017. */
export const CUSTOM_GROUP_STYLE: CategoryStyle = { icon: { kind: "SYMBOL", name: "tag" }, color: "GRAPHITE" };

// The longest RGI emoji sequences (a kiss with two skin tones, a subdivision flag) take 15 UTF-16 code units.
const MAX_EMOJI_LENGTH = 32;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTOGRAPHIC_START = /^\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;

/**
 * HU-E3-05, ruling P59: one grapheme (one extended grapheme cluster, UAX #29) of at most 32 UTF-16 code units that
 * starts with a pictograph (Extended_Pictographic) or is a flag (one pair of regional indicators). A ZWJ sequence and
 * a skin tone are one grapheme (the joiner and the modifier extend the cluster), so they pass; a keycap starts with a
 * digit and is refused, while a text-default pictograph such as © passes. The rule checks this shape, not the Unicode
 * emoji list: whatever extends a pictograph within the cap, combining marks included, is part of the same grapheme.
 */
export const isOneEmoji = (value: string): boolean => {
  if (value.length > MAX_EMOJI_LENGTH) return false;
  if ([...graphemes.segment(value)].length !== 1) return false;
  return PICTOGRAPHIC_START.test(value) || FLAG.test(value);
};

const isSymbol = (name: string): name is CategorySymbol =>
  (CATEGORY_SYMBOLS as readonly string[]).includes(name);

/** HU-E3-05: an unknown symbol, or a value that `isOneEmoji` refuses, is `InvalidCategoryIcon`. */
export const categoryIconOf = (input: IconInput): Result<CategoryIcon> => {
  if (input.kind === "SYMBOL") {
    return isSymbol(input.name)
      ? ok<CategoryIcon>({ kind: "SYMBOL", name: input.name })
      : err(domainError("InvalidCategoryIcon"));
  }
  return isOneEmoji(input.value)
    ? ok<CategoryIcon>({ kind: "EMOJI", value: input.value })
    : err(domainError("InvalidCategoryIcon"));
};

/**
 * A request's style change: the icon checked here, the color already a palette key (the contract's enum). A part left
 * out has no key in the change, so spreading the change over a style never overwrites a part with `undefined`.
 */
export const styleChangeOf = (input: {
  readonly icon?: IconInput;
  readonly color?: CategoryColor;
}): Result<StyleChange> => {
  const colorPart: StyleChange = input.color === undefined ? {} : { color: input.color };
  if (input.icon === undefined) return ok(colorPart);
  const icon = categoryIconOf(input.icon);
  return icon.ok ? ok({ icon: icon.value, ...colorPart }) : icon;
};

export const changesStyle = (change: StyleChange): boolean =>
  change.icon !== undefined || change.color !== undefined;

/** `change` over `style`, part by part. */
export const restyled = (style: CategoryStyle, change: StyleChange): CategoryStyle => ({
  icon: change.icon ?? style.icon,
  color: change.color ?? style.color,
});
