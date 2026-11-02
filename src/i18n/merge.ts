export type Messages = { readonly [key: string]: string | Messages };

/**
 * Ruling P276: the core catalog and its areas as one tree, each namespace's keys from every file that holds some (a
 * key lives in one file only, `scripts/i18n-check.mjs`). The inputs stay as they are.
 */
export const mergeMessages = (...catalogs: readonly Messages[]): Messages => {
  const merged: Record<string, string | Messages> = {};
  for (const catalog of catalogs)
    for (const [key, value] of Object.entries(catalog)) {
      const before = merged[key];
      merged[key] =
        typeof value === "object" && typeof before === "object" ? mergeMessages(before, value) : value;
    }
  return merged;
};
