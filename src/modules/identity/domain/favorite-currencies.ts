import { domainError, err, knownCurrency, ok, type Result } from "@/shared/kernel";

/** P342: the most favorite currencies a person keeps. */
export const MAX_FAVORITE_CURRENCIES = 20;

/**
 * P342 (S2): a person's favorite currencies, the ones a currency picker offers after the space's own, in the person's
 * order. Each is a known ISO 4217 code, whatever its case ("usd" is USD); a repeated code keeps its first place; more
 * than 20 distinct codes is TooManyFavoriteCurrencies, and an unknown one is UnknownCurrency.
 */
export const parseFavoriteCurrencies = (codes: readonly string[]): Result<readonly string[]> => {
  const favorites: string[] = [];
  for (const raw of codes) {
    const code = raw.toUpperCase();
    if (knownCurrency(code) === undefined) return err(domainError("UnknownCurrency", { currency: raw }));
    if (!favorites.includes(code)) favorites.push(code);
  }
  if (favorites.length > MAX_FAVORITE_CURRENCIES) {
    return err(domainError("TooManyFavoriteCurrencies", { max: MAX_FAVORITE_CURRENCIES }));
  }
  return ok(favorites);
};
