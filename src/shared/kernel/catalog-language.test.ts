import { describe, expect, it } from "vitest";
import { catalogLanguage } from "./catalog-language";

describe("catalogLanguage (HU-E3-01)", () => {
  it("names seeded catalogs in English for English locales, whatever their case", () => {
    expect(catalogLanguage("en")).toBe("en");
    expect(catalogLanguage("en-US")).toBe("en");
    expect(catalogLanguage("EN")).toBe("en");
  });

  it("falls back to Spanish for every other locale", () => {
    expect(catalogLanguage("es-CO")).toBe("es");
    expect(catalogLanguage("fr")).toBe("es");
    expect(catalogLanguage("")).toBe("es");
  });
});
