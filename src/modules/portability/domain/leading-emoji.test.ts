import { describe, expect, it } from "vitest";
import { splitLeadingEmoji } from "./leading-emoji";

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
