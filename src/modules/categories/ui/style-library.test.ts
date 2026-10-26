import { describe, expect, it } from "vitest";
import {
  EMOJI_SECTIONS,
  emojiIdOf,
  librarySections,
  QUICK_EMOJI,
  quickChoices,
  searchLibrary,
  SYMBOL_SECTIONS,
} from "./style-library";

describe("icon library (HU-E9-04)", () => {
  it("sections the 58 category symbols in nine sections, each once", () => {
    const names = SYMBOL_SECTIONS.flatMap((section) => section.names);
    expect(SYMBOL_SECTIONS).toHaveLength(9);
    expect(names).toHaveLength(58);
    expect(new Set(names).size).toBe(58);
  });

  it("lists every emoji once, as one grapheme, and the quick ones are its first 11", () => {
    const all = EMOJI_SECTIONS.flatMap((section) => section.emoji.map(([, value]) => value));
    const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
    expect(new Set(all).size).toBe(all.length);
    for (const value of all) expect([...graphemes.segment(value)], value).toHaveLength(1);
    expect(QUICK_EMOJI).toEqual(all.slice(0, 11));
    expect(emojiIdOf("🛒")).toBe("cart");
    expect(emojiIdOf("🦄")).toBeNull();
  });

  it("puts a current choice outside the quick set first, so it stays visible", () => {
    expect(quickChoices("SYMBOL", { kind: "SYMBOL", name: "cart" })).toHaveLength(11);
    const paw = quickChoices("SYMBOL", { kind: "SYMBOL", name: "paw" });
    expect(paw).toHaveLength(11);
    expect(paw[0]).toEqual({ kind: "SYMBOL", name: "paw" });
    expect(paw.at(-1)).toEqual({ kind: "SYMBOL", name: "book" });
    // An emoji the library does not list still shows, on the emoji tab only.
    expect(quickChoices("EMOJI", { kind: "EMOJI", value: "🦄" })[0]).toEqual({ kind: "EMOJI", value: "🦄" });
    expect(quickChoices("EMOJI", { kind: "SYMBOL", name: "paw" })[0]).toEqual({ kind: "EMOJI", value: "🛒" });
  });

  it("searches a choice's label or its section's name, ignoring case and accents", () => {
    const sections = librarySections(
      "SYMBOL",
      (key) => ({ "symbol.plane": "Avión", "symbolSection.money": "Dinero" })[key as string] ?? key,
    );
    expect(searchLibrary(sections, "AVION").flatMap((s) => s.choices.map((c) => c.label))).toEqual(["Avión"]);
    expect(searchLibrary(sections, "dinero").map((s) => [s.name, s.choices.length])).toEqual([["Dinero", 7]]);
    expect(searchLibrary(sections, "unicornio")).toEqual([]);
    expect(searchLibrary(sections, "  ")).toHaveLength(9);
  });
});
