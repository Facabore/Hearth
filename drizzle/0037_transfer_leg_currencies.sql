-- D29, slice MC3: the currency each transfer leg is in. A leg's amount is in its account's own currency (4.1), and a
-- leg's currency is a stable, denormalized fact: an account's currency is fixed once it has movements. Forward-only and
-- purely additive: both columns are nullable with no back-fill (no transfer carries a leg yet), so each row reads
-- exactly as before (null = the leg equals the base amount in the base currency). The CHECK pairs each currency with
-- its leg amount; a transfer's "Llega" only, so an income's own-currency destination leg (its original currency) is left
-- out of the destination pairing.
ALTER TABLE "transactions" ADD COLUMN "source_currency" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "destination_currency" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_leg_currencies" CHECK (("transactions"."source_currency" IS NULL) = ("transactions"."source_amount" IS NULL)
        AND ("transactions"."type" = 'INCOME' OR ("transactions"."destination_currency" IS NULL) = ("transactions"."destination_amount" IS NULL)));