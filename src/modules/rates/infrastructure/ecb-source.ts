import { domainError, err, localDate, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import type { ExchangeRateSource, SourceRate, SourceRates } from "../application";

/** The European Central Bank's daily euro reference rates (D30, Q1): free, about 30 currencies, based on EUR. */
const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
/** Every publication since 1999, about 8 MB: read once to fill in the history. */
const ECB_HISTORY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
const HISTORY_TIMEOUT_MS = 120_000;

/** One day's cube: its inner currency cubes close themselves, so the first `</Cube>` ends the day. */
const DAY = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
const RATE = /currency=['"]([A-Za-z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]/g;

const unavailable = (reason: string) =>
  err(domainError("ExchangeRateSourceUnavailable", { source: "ecb", reason }));

/** Every day cube in a feed, as EUR-based rates; a cube with an unreadable date or no rate is left out. */
const daysOf = (body: string): SourceRates[] => {
  const days: SourceRates[] = [];
  for (const [, time, cubes] of body.matchAll(DAY)) {
    const date = localDate(time!);
    const rates: SourceRate[] = [...cubes!.matchAll(RATE)].map(([, quote, rate]) => ({
      quote: quote!.toUpperCase(),
      rate: rate!,
    }));
    if (date.ok && rates.length > 0) days.push({ source: "ecb", base: "EUR", date: date.value, rates });
  }
  return days;
};

/**
 * D30: reads ECB's reference-rate feeds: `eurofxref-daily.xml` for the day and `eurofxref-hist.xml` for the history.
 * They are small, stable XML, so they are matched directly rather than with an XML dependency. A fetch or parse
 * failure is `ExchangeRateSourceUnavailable`.
 */
export class EcbSource implements ExchangeRateSource {
  readonly key = "ecb";

  constructor(
    private readonly http: HttpGet,
    private readonly url: string = ECB_DAILY_URL,
    private readonly historyUrl: string = ECB_HISTORY_URL,
  ) {}

  async fetch(): Promise<Result<SourceRates>> {
    let body: string;
    try {
      body = await this.http.getText(this.url);
    } catch (cause) {
      return unavailable(String(cause));
    }
    const [day] = daysOf(body);
    return day ? ok(day) : unavailable("no rates");
  }

  async history(from: LocalDate): Promise<Result<readonly SourceRates[]>> {
    let body: string;
    try {
      body = await this.http.getText(this.historyUrl, HISTORY_TIMEOUT_MS);
    } catch (cause) {
      return unavailable(String(cause));
    }
    const days = daysOf(body)
      .filter((d) => d.date >= from)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return days.length > 0 ? ok(days) : unavailable("no history");
  }
}
