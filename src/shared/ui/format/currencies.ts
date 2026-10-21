/** HU-E9-02: the symbol a currency shows, never the language's (P68); amounts on the wire are minor units. */
const CURRENCIES: Readonly<Record<string, { readonly symbol: string; readonly exponent: number }>> = {
  COP: { symbol: "$", exponent: 2 },
  USD: { symbol: "US$", exponent: 2 },
  EUR: { symbol: "€", exponent: 2 },
};

/** A known currency's symbol and exponent; an unknown code shows itself, with exponent 2. */
export const currencyOf = (code: string): { symbol: string; exponent: number } =>
  CURRENCIES[code] ?? { symbol: code, exponent: 2 };
