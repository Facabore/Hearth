const namers = new Map<string, Intl.DisplayNames>();

/**
 * D29 (boards 12 and 13): a currency's name in the person's language, as a sentence carries it ("dólar
 * estadounidense"); the code itself when the runtime has no name for it. Names are copy, so they follow the language;
 * amounts keep following the formats (D23).
 */
export const currencyName = (code: string, locale: string): string => {
  let namer = namers.get(locale);
  if (namer === undefined) {
    namer = new Intl.DisplayNames([locale], { type: "currency", fallback: "code" });
    namers.set(locale, namer);
  }
  return namer.of(code) ?? code;
};

/** D29 (board 13): a currency's name as a row or a field shows it, its first letter capitalized. */
export const currencyTitle = (code: string, locale: string): string => {
  const name = currencyName(code, locale);
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
};
