import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale (HU-E9-02, ruling P120)", () => {
  it("lets the signed-in user's stored locale win over the cookie and the browser", () => {
    expect(resolveLocale({ userLocale: "en", cookieLocale: "es", acceptLanguage: "es-CO,es;q=0.9" })).toBe(
      "en",
    );
  });

  it("then takes the visitor's cookie, then the first supported browser language by weight", () => {
    expect(resolveLocale({ cookieLocale: "en", acceptLanguage: "es-CO" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "de-DE, fr;q=0.9, en;q=0.5" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "en;q=0.4, es;q=0.6" })).toBe("es");
  });

  it("falls back to Spanish for no supported preference and ignores unsupported stored values", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("es");
    expect(resolveLocale({ acceptLanguage: null })).toBe("es");
    expect(resolveLocale({ userLocale: "pt", cookieLocale: "xx", acceptLanguage: "en" })).toBe("en");
  });
});
