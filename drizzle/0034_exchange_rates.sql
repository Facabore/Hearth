-- D30: daily exchange rates. Forward-only and additive: one new global table, no existing row is rewritten or deleted.
-- A rate is a public fact (no space, no user); a past rate never changes, so the same (date, base, quote, source) is
-- inserted at most once. Cross rates are computed on read, never stored.
CREATE TABLE "exchange_rates" (
	"date" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exchange_rates_day_pair_source" UNIQUE("date","base","quote","source")
);
--> statement-breakpoint
CREATE INDEX "exchange_rates_pair_date_idx" ON "exchange_rates" USING btree ("base","quote","date");