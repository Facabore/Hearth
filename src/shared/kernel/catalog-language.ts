/** The languages seeded names come in (default categories, starter accounts). */
export type CatalogLanguage = "es" | "en";

/** English for "en…" locales; Spanish otherwise (primary locale es-CO). Shared by every seeded catalog (HU-E3-01). */
export const catalogLanguage = (locale: string): CatalogLanguage =>
  locale.toLowerCase().startsWith("en") ? "en" : "es";
