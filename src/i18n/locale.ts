/** HU-E9-02: the interface languages; a language never sets a format (D23). Mirrors identity's LOCALES. */
export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
/** Ruling P120: a visitor's choice on the sign-in and sign-up screens. */
export const LOCALE_COOKIE = "hearth.locale";

const supported = (value: string | null | undefined): Locale | null =>
  (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : null;

/** The first supported language of an Accept-Language header, by weight then order. */
const fromAcceptLanguage = (header: string | null | undefined): Locale | null =>
  (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { language: tag.toLowerCase().split("-")[0] ?? "", weight: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((entry) => entry.weight > 0 && supported(entry.language) !== null)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.language as Locale)[0] ?? null;

/** HU-E9-02, ruling P120: the stored locale, then the visitor cookie, then Accept-Language, then Spanish. */
export const resolveLocale = (input: {
  readonly userLocale?: string | null;
  readonly cookieLocale?: string | null;
  readonly acceptLanguage?: string | null;
}): Locale =>
  supported(input.userLocale) ??
  supported(input.cookieLocale) ??
  fromAcceptLanguage(input.acceptLanguage) ??
  DEFAULT_LOCALE;
