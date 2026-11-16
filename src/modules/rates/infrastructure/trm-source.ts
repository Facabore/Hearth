import { domainError, err, localDate, ok, type Result } from "@/shared/kernel";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import type { ExchangeRateSource, SourceRates } from "../application";

/**
 * Banco de la República's TRM, the official COP rate (D30, Q1), free on datos.gov.co. The latest row first; the TRM is
 * pesos per US dollar, so it is stored as USD->COP, for the day it takes effect (`vigenciadesde`).
 */
const TRM_LATEST_URL =
  "https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC";

interface TrmRow {
  readonly valor?: string;
  readonly vigenciadesde?: string;
}

/**
 * D30: reads the latest TRM and parses it to one USD->COP rate. A fetch, JSON, or shape failure is
 * `ExchangeRateSourceUnavailable`.
 */
export class TrmSource implements ExchangeRateSource {
  readonly key = "trm";

  constructor(
    private readonly http: HttpGet,
    private readonly url: string = TRM_LATEST_URL,
  ) {}

  async fetch(): Promise<Result<SourceRates>> {
    let rows: TrmRow[];
    try {
      const body = await this.http.getText(this.url);
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      rows = parsed as TrmRow[];
    } catch (cause) {
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: String(cause) }));
    }

    const latest = rows[0];
    if (!latest?.valor || !latest.vigenciadesde) {
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: "empty" }));
    }
    const date = localDate(latest.vigenciadesde.slice(0, 10));
    if (!date.ok)
      return err(domainError("ExchangeRateSourceUnavailable", { source: this.key, reason: "bad date" }));

    return ok({
      source: this.key,
      base: "USD",
      date: date.value,
      rates: [{ quote: "COP", rate: latest.valor }],
    });
  }
}
