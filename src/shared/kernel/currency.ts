import { domainError } from "./domain-error";
import { minorUnitsOf } from "./minor-units";
import { err, ok, type Result } from "./result";

export interface Currency {
  readonly code: string;
  /** ISO 4217 minor-unit exponent. */
  readonly exponent: number;
  /** Smallest amount used for splits and allocations, in minor units (spec 5.3). */
  readonly roundingUnit: bigint;
}

/**
 * D29: every circulating ISO 4217 currency, plus a few withdrawn recently that old exports may still carry (ANG, BGN,
 * HRK). Funds, precious metals and test codes are left out. Their decimals and rounding come from `minor-units.ts`.
 */
const CODES =
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF " +
  "CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK " +
  "HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL " +
  "MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON " +
  "RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH " +
  "UGX USD UYU UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG";

// A Map, not an object literal, so inherited keys such as "constructor" are never currencies.
const CURRENCIES: ReadonlyMap<string, Currency> = new Map(
  CODES.split(" ").map((code): [string, Currency] => [code, { code, ...minorUnitsOf(code) }]),
);

/** The currency with this ISO code, or undefined: for callers that only format and fall back on their own. */
export const knownCurrency = (code: string): Currency | undefined => CURRENCIES.get(code);

export const currencyOf = (code: string): Result<Currency> => {
  const currency = CURRENCIES.get(code);
  return currency ? ok(currency) : err(domainError("UnknownCurrency", { currency: code }));
};
