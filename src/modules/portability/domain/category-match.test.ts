import { describe, expect, it } from "vitest";
import { matchCatalog, splitLeadingEmoji } from "./category-match";

describe("splitLeadingEmoji (D22, design §2.2)", () => {
  it("lifts a single leading emoji into the icon and leaves the name", () => {
    expect(splitLeadingEmoji("🍔 Food")).toEqual({ icon: "🍔", name: "Food" });
  });

  it("keeps a ZWJ emoji sequence whole", () => {
    expect(splitLeadingEmoji("👨‍👩‍👧 Familia")).toEqual({ icon: "👨‍👩‍👧", name: "Familia" });
  });

  it("keeps an emoji with a variation selector whole", () => {
    expect(splitLeadingEmoji("❤️ Amor")).toEqual({ icon: "❤️", name: "Amor" });
  });

  it("leaves a name without a leading emoji untouched", () => {
    expect(splitLeadingEmoji("Supermercado")).toEqual({ icon: null, name: "Supermercado" });
  });

  it("trims surrounding whitespace", () => {
    expect(splitLeadingEmoji("  🚌  Transporte  ")).toEqual({ icon: "🚌", name: "Transporte" });
  });
});

describe("matchCatalog (design §2.2)", () => {
  it("maps built-in expense names to catalog keys", () => {
    expect(matchCatalog("Food", "EXPENSE")).toEqual({ kind: "catalog", catalogKey: "groceries" });
    expect(matchCatalog("Social Life", "EXPENSE")).toEqual({ kind: "catalog", catalogKey: "going_out" });
    expect(matchCatalog("Transport", "EXPENSE")).toEqual({
      kind: "catalog",
      catalogKey: "public_transport",
    });
  });

  it("maps built-in income names to catalog keys", () => {
    expect(matchCatalog("Salary", "INCOME")).toEqual({ kind: "catalog", catalogKey: "salary" });
    expect(matchCatalog("Allowance", "INCOME")).toEqual({ kind: "catalog", catalogKey: "other_income" });
  });

  it("distinguishes the two 'Other' built-ins by kind", () => {
    expect(matchCatalog("Other", "INCOME")).toEqual({ kind: "catalog", catalogKey: "other_income" });
    expect(matchCatalog("Other", "EXPENSE")).toEqual({ kind: "new", groupKey: "other" });
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(matchCatalog("  food ", "EXPENSE")).toEqual({ kind: "catalog", catalogKey: "groceries" });
  });

  it("proposes a new category in Otros for an unknown name", () => {
    expect(matchCatalog("Guitarra", "EXPENSE")).toEqual({ kind: "new", groupKey: "other" });
  });
});
