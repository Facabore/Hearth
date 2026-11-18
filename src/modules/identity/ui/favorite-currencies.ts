import type { MeDto } from "@/shared/ui/api/dto";

/**
 * P342 (S2): the person's favorite currencies as the pickers offer them. Until they choose some (the API sends none),
 * their personal space's currency is the only one; no backfill is stored. An empty list they chose stays empty.
 */
export const favoriteCurrenciesOf = (me: MeDto, personalCurrency: string | undefined): readonly string[] =>
  me.preferences.favoriteCurrencies ?? (personalCurrency === undefined ? [] : [personalCurrency]);
