/**
 * Ruling P276 (#235): the catalog areas. Each is a file per language, `messages/areas/<area>.<locale>.json`, that loads
 * with the routes that declare it (`staticData.areas`); every other key lives in the core catalog, `messages/<locale>.json`.
 */
export const AREAS = [
  "plan",
  "recurrences",
  "categories",
  "members",
  "accounts",
  "settings",
  "space",
  "invitation",
  "trust",
] as const;
export type Area = (typeof AREAS)[number];
