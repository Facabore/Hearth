import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  CATEGORY_COLORS,
  CATEGORY_SYMBOLS,
  CUSTOM_GROUP_STYLE,
  categoryIconOf,
  changesStyle,
  isOneEmoji,
  restyled,
  styleChangeOf,
  type CategoryStyle,
} from "./category-style";

/** The nine sections of the icon library (HU-E3-05): UI metadata, so the domain keeps only the flat set they add up to. */
const SECTIONS: readonly (readonly [string, readonly string[]])[] = [
  ["Food", ["cart", "bread", "cup", "fork", "apple", "wine", "pizza", "basket"]],
  ["Home", ["home", "bulb", "droplet", "flame", "wifi", "wrench", "key", "sofa"]],
  ["Transport", ["bus", "car", "fuel", "bike", "plane", "train", "parking"]],
  ["Health and care", ["heart", "pill", "cross", "tooth", "gym", "scissors", "leaf"]],
  ["Leisure", ["ticket", "music", "game", "tv", "book", "gift", "globe"]],
  ["Shopping", ["shirt", "bag", "tag", "phone", "laptop"]],
  ["Money", ["card", "bank", "piggy", "coins", "chart", "receipt", "percent"]],
  ["People and work", ["users", "paw", "graduation", "briefcase"]],
  ["Other", ["star", "umbrella", "shield", "calendar", "dots"]],
];

// Invisible characters of the rows below, written as escapes so the source shows what the rows hold.
const ACUTE = "\u0301"; // a combining mark: it extends the grapheme before it
const PREPENDED_MARK = "\u0600"; // a Prepend character: the grapheme it opens starts with it, not with what follows
const ENGLAND_FLAG = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"; // a flag and six tags: 14 units
const KISS_WITH_TONES = "\u{1F469}\u{1F3FB}\u200D\u2764\uFE0F\u200D\u{1F48B}\u200D\u{1F468}\u{1F3FC}"; // 15 units

describe("category icons (HU-E3-05)", () => {
  it("takes exactly the 58 names of the nine sections, each once, and no other", () => {
    const listed = SECTIONS.flatMap(([, names]) => names);
    expect(SECTIONS).toHaveLength(9);
    expect(listed).toHaveLength(58);
    expect(CATEGORY_SYMBOLS).toHaveLength(58);
    expect(new Set(CATEGORY_SYMBOLS).size).toBe(58);
    expect([...CATEGORY_SYMBOLS].sort()).toEqual([...listed].sort());
    for (const name of listed) {
      expect(unwrap(categoryIconOf({ kind: "SYMBOL", name }))).toEqual({ kind: "SYMBOL", name });
    }
  });

  it("refuses a name outside the set, or spelled in another case", () => {
    for (const name of ["unicorn", "Cart", "CART", " cart", "cart ", ""]) {
      expect(codeOf(categoryIconOf({ kind: "SYMBOL", name }))).toBe("InvalidCategoryIcon");
    }
  });

  it.each([
    ["🛒", "one emoji"],
    ["❤️", "an emoji with its presentation selector"],
    ["👍🏽", "a skin tone, which extends its emoji"],
    ["👩‍💻", "a ZWJ sequence"],
    ["👨‍👩‍👧‍👦", "a ZWJ family of four"],
    ["🇨🇴", "a flag of two regional indicators"],
    ["©", "a text-default pictograph, with no presentation selector"],
    [ENGLAND_FLAG, "the England subdivision flag, a flag with tag characters"],
    [KISS_WITH_TONES, "a kiss with two skin tones, the longest sequence at 15 code units"],
  ])("takes %s (%s) as exactly one emoji", (value) => {
    expect(isOneEmoji(value)).toBe(true);
    expect(unwrap(categoryIconOf({ kind: "EMOJI", value }))).toEqual({ kind: "EMOJI", value });
  });

  it("builds the long rows from the code points they name, 14 and 15 units under the cap of 32", () => {
    expect([ENGLAND_FLAG.length, KISS_WITH_TONES.length]).toEqual([14, 15]);
  });

  it.each([
    ["🛒🍞", "two emojis"],
    ["a", "a letter"],
    ["", "nothing"],
    [" 🛒", "a space before an emoji"],
    ["1️⃣", "a keycap"],
    ["🛒".padEnd(34, ACUTE), "one grapheme of 34 code units"],
    ["🇨", "a lone regional indicator"],
    [`🇨🇴${ACUTE}`, "a flag followed by a combining mark"],
    [`${PREPENDED_MARK}🛒`, "an emoji after a prepended mark, so the grapheme does not start with it"],
    [`${PREPENDED_MARK}🇨🇴`, "a flag after a prepended mark, so the grapheme does not start with it"],
  ])("refuses %s (%s)", (value) => {
    expect(isOneEmoji(value)).toBe(false);
    expect(codeOf(categoryIconOf({ kind: "EMOJI", value }))).toBe("InvalidCategoryIcon");
  });

  it("caps one grapheme at 32 UTF-16 code units: 32 is taken, 33 is refused", () => {
    // No emoji sequence comes near the cap (the longest RGI ones take 15 units), so the boundary is built from an
    // emoji and combining marks, which UAX #29 keeps in the same grapheme.
    const segments = new Intl.Segmenter("en", { granularity: "grapheme" });
    const atCap = "🛒".padEnd(32, ACUTE);
    const overCap = "🛒".padEnd(33, ACUTE);
    expect([atCap.length, overCap.length]).toEqual([32, 33]);
    expect([...segments.segment(atCap)]).toHaveLength(1);
    expect([...segments.segment(overCap)]).toHaveLength(1);
    expect(isOneEmoji(atCap)).toBe(true);
    expect(unwrap(categoryIconOf({ kind: "EMOJI", value: atCap }))).toEqual({ kind: "EMOJI", value: atCap });
    expect(isOneEmoji(overCap)).toBe(false);
    expect(codeOf(categoryIconOf({ kind: "EMOJI", value: overCap }))).toBe("InvalidCategoryIcon");
  });
});

describe("category styles (HU-E3-05, D22)", () => {
  const sand: CategoryStyle = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };

  it("has sixteen palette keys, in the order of the color row, and a custom default for groups", () => {
    expect(CATEGORY_COLORS).toEqual([
      "PINE",
      "SAGE",
      "OLIVE",
      "SAND",
      "MUSTARD",
      "AMBER",
      "EMBER",
      "CORAL",
      "ROSE",
      "PLUM",
      "LAVENDER",
      "INDIGO",
      "SKY",
      "TEAL",
      "STEEL",
      "GRAPHITE",
    ]);
    expect(new Set(CATEGORY_COLORS).size).toBe(16);
    expect(CUSTOM_GROUP_STYLE).toEqual({ icon: { kind: "SYMBOL", name: "tag" }, color: "GRAPHITE" });
  });

  it("changes only the parts that are sent, and checks a sent icon", () => {
    expect(restyled(sand, {})).toEqual(sand);
    expect(restyled(sand, { color: "ROSE" })).toEqual({ icon: sand.icon, color: "ROSE" });
    expect(unwrap(styleChangeOf({ icon: { kind: "EMOJI", value: "🛒" } }))).toEqual({
      icon: { kind: "EMOJI", value: "🛒" },
    });
    expect(codeOf(styleChangeOf({ icon: { kind: "SYMBOL", name: "unicorn" }, color: "ROSE" }))).toBe(
      "InvalidCategoryIcon",
    );
  });

  it("replaces the icon when one is sent, with or without a color", () => {
    const emoji = { kind: "EMOJI", value: "🛒" } as const;
    expect(restyled(sand, { icon: emoji })).toEqual({ icon: emoji, color: "SAND" });
    expect(restyled(sand, { icon: emoji, color: "ROSE" })).toEqual({ icon: emoji, color: "ROSE" });
  });

  it("builds the change from the parts sent, with no key for a part left out", () => {
    const cart = { kind: "SYMBOL", name: "cart" } as const;
    expect(unwrap(styleChangeOf({}))).toStrictEqual({});
    expect(unwrap(styleChangeOf({ color: "ROSE" }))).toStrictEqual({ color: "ROSE" });
    expect(unwrap(styleChangeOf({ icon: cart }))).toStrictEqual({ icon: cart });
    expect(unwrap(styleChangeOf({ icon: cart, color: "ROSE" }))).toStrictEqual({ icon: cart, color: "ROSE" });
  });

  it("leaves a style part alone when a change built from a request leaves it out", () => {
    expect({ ...sand, ...unwrap(styleChangeOf({ icon: { kind: "SYMBOL", name: "bag" } })) }).toStrictEqual({
      icon: { kind: "SYMBOL", name: "bag" },
      color: "SAND",
    });
    expect({ ...sand, ...unwrap(styleChangeOf({ color: "ROSE" })) }).toStrictEqual({
      icon: sand.icon,
      color: "ROSE",
    });
  });

  it("tells whether a change touches the style", () => {
    expect(changesStyle({})).toBe(false);
    expect(changesStyle(unwrap(styleChangeOf({})))).toBe(false);
    expect(changesStyle({ color: "ROSE" })).toBe(true);
    expect(changesStyle({ icon: sand.icon })).toBe(true);
    expect(changesStyle({ icon: sand.icon, color: "ROSE" })).toBe(true);
  });
});
