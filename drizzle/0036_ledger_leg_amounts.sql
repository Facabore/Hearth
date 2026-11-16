-- D29, slice MC3: the storage for per-leg and original amounts. Forward-only and purely additive: every new column is
-- nullable with no back-fill, so each row reads exactly as before (null = the leg/original equals the base amount in
-- the base currency). The base `amount` stays in the space's base currency, so every existing read keeps working; a
-- later slice records in another currency and sets these. The CHECKs only constrain a present value to be positive.
ALTER TABLE "payments" ADD COLUMN "account_amount" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_amount" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_currency" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source_amount" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "destination_amount" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_amount_positive" CHECK ("payments"."account_amount" IS NULL OR "payments"."account_amount" > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_leg_amounts_positive" CHECK (("transactions"."original_amount" IS NULL OR "transactions"."original_amount" > 0)
        AND ("transactions"."source_amount" IS NULL OR "transactions"."source_amount" > 0)
        AND ("transactions"."destination_amount" IS NULL OR "transactions"."destination_amount" > 0));