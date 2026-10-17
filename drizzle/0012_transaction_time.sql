DROP INDEX "transactions_space_date_idx";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "time_zone" text;--> statement-breakpoint
CREATE INDEX "transactions_space_order_idx" ON "transactions" USING btree ("space_id","date",coalesce("occurred_at", '-infinity'::timestamptz),"created_at","id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_time_zone" CHECK (("transactions"."occurred_at" IS NULL) = ("transactions"."time_zone" IS NULL));