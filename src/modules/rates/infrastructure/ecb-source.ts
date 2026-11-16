import { domainError, err, localDate, ok, type Result } from "@/shared/kernel";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import type { ExchangeRateSource, SourceRate, SourceRates } from "../application";

/** The European Central Bank's daily euro reference rates (D30, Q1): free, about 30 currencies, based on EUR. */
const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const DATE = /time=['"](\d{4}-\d{2}-\d{2})['"]/;
const RATE = /currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]/g;

/**
 * D30: reads ECB's `eurofxref-daily.xml` and parses it to a day's EUR-based rates. The feed is a tiny, stable XML, so
 * it is matched directly rather than with an XML dependency. A fetch or parse failure is `ExchangeRateSourceUnavailable`.
 */
export class EcbSource implements ExchangeRateSource {
  readonly key = "ecb";

  constructor(
    private readonly http: HttpGet,
    private readonly url: string = ECB_DAILY_URL,
  ) {}

  async fetch(): Promise<Result<SourceRates>> {
    let body: string;
    try {
      body = await this.http.getText(this.url);
    } catch (cause) {
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: String(cause) }));
    }

    const day = body.match(DATE);
    if (!day)
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: "no date" }));
    const date = localDate(day[1]!);
    if (!date.ok)
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: "bad date" }));

    const rates: SourceRate[] = [];
    for (const match of body.matchAll(RATE)) {
      rates.push({ quote: match[1]!.toUpperCase(), rate: match[2]! });
    }
    if (rates.length === 0) {
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: "no rates" }));
    }

    return ok({ source: this.key, base: "EUR", date: date.value, rates });
  }
}
