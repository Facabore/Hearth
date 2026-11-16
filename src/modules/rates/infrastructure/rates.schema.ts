import { date, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * D30: daily exchange rates. Global: a rate is a public fact, not anyone's data, so there is no space or user. A past
 * rate never changes, so rows are forward-only; the same (date, base, quote, source) is inserted at most once. `rate`
 * is the exact decimal exactly as `ExchangeRate.value` renders it (text to round-trip without loss; the kernel keeps
 * rates as text decimals). Cross rates are computed on read (`crossRate`), never stored.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    date: date("date", { mode: "string" }).notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: text("rate").notNull(),
    source: text("source").notNull(),
    fetchedAt: tz("fetched_at").notNull(),
  },
  (t) => [
    unique("exchange_rates_day_pair_source").on(t.date, t.base, t.quote, t.source),
    index("exchange_rates_pair_date_idx").on(t.base, t.quote, t.date),
  ],
);
