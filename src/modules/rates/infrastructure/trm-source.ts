import { domainError, err, localDate, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import type { ExchangeRateSource, SourceRates } from "../application";

/**
 * Banco de la República's TRM, the official COP rate (D30, Q1), free on datos.gov.co (dataset 32sa-8pi3). The TRM is
 * pesos per US dollar, so it is stored as USD->COP, for the day it takes effect (`vigenciadesde`).
 */
const TRM_DATASET = "https://www.datos.gov.co/resource/32sa-8pi3.json";
const TRM_LATEST_URL = `${TRM_DATASET}?$limit=1&$order=vigenciadesde%20DESC`;
/** The whole history since 1991 is under 9,000 rows, so one page holds it. */
const historyUrl = (from: LocalDate) =>
  `${TRM_DATASET}?$where=vigenciadesde%20%3E%3D%20'${from}'&$order=vigenciadesde%20ASC&$limit=50000`;
const HISTORY_TIMEOUT_MS = 120_000;

interface TrmRow {
  readonly valor?: string;
  readonly vigenciadesde?: string;
}

const unavailable = (reason: string) =>
  err(domainError("ExchangeRateSourceUnavailable", { source: "trm", reason }));

/** One row as a day's USD->COP rate, or null when it has no value or no readable date. */
const dayOf = (row: TrmRow): SourceRates | null => {
  if (!row.valor || !row.vigenciadesde) return null;
  const date = localDate(row.vigenciadesde.slice(0, 10));
  return date.ok
    ? { source: "trm", base: "USD", date: date.value, rates: [{ quote: "COP", rate: row.valor }] }
    : null;
};

/**
 * D30: reads the TRM from datos.gov.co: the latest row for the day, or every row from a day on for the history. A
 * fetch, JSON, or shape failure is `ExchangeRateSourceUnavailable`.
 */
export class TrmSource implements ExchangeRateSource {
  readonly key = "trm";

  constructor(
    private readonly http: HttpGet,
    private readonly url: string = TRM_LATEST_URL,
  ) {}

  async fetch(): Promise<Result<SourceRates>> {
    const rows = await this.rows(this.url);
    if (!rows.ok) return rows;
    const latest = rows.value[0] ? dayOf(rows.value[0]) : null;
    return latest ? ok(latest) : unavailable("empty");
  }

  async history(from: LocalDate): Promise<Result<readonly SourceRates[]>> {
    const rows = await this.rows(historyUrl(from), HISTORY_TIMEOUT_MS);
    if (!rows.ok) return rows;
    const days = rows.value.map(dayOf).filter((d): d is SourceRates => d !== null);
    return days.length > 0 ? ok(days) : unavailable("no history");
  }

  private async rows(url: string, timeoutMs?: number): Promise<Result<readonly TrmRow[]>> {
    try {
      const parsed: unknown = JSON.parse(await this.http.getText(url, timeoutMs));
      if (!Array.isArray(parsed)) return unavailable("not an array");
      return ok(parsed as TrmRow[]);
    } catch (cause) {
      return unavailable(String(cause));
    }
  }
}
