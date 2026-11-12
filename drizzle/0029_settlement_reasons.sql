-- Ruling P322: a settlement may pay a third member's debt, give that payment away, or forgive a debt. Forward-only and
-- additive: three nullable columns, a unique key and checks; no row is rewritten or deleted. A settlement recorded
-- before this migration keeps a null settlement_reason, which reads as PAYMENT (what every one of them was), so no
-- backfill touches the stored rows. The member a payment was made for and the other half of a gift belong to the
-- transaction's space, like its other members (composite keys, ruling P288). drizzle-kit generated the statements;
-- they are reordered by hand so the unique key (id, space_id) exists before the foreign key that needs it.
ALTER TABLE "transactions" ADD COLUMN "settlement_reason" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "on_behalf_of_member_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "linked_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_on_behalf_of_member_space_fk" FOREIGN KEY ("on_behalf_of_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_space_uq" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_linked_transaction_space_fk" FOREIGN KEY ("linked_transaction_id","space_id") REFERENCES "public"."transactions"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settlement_reason" CHECK ("transactions"."settlement_reason" IS NULL OR ("transactions"."type" = 'SETTLEMENT' AND "transactions"."settlement_reason" IN ('PAYMENT', 'GIFT', 'FORGIVENESS')
        AND ("transactions"."settlement_reason" = 'PAYMENT' OR ("transactions"."source_account_id" IS NULL AND "transactions"."destination_account_id" IS NULL))));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_on_behalf_of" CHECK ("transactions"."on_behalf_of_member_id" IS NULL OR ("transactions"."type" = 'SETTLEMENT' AND "transactions"."on_behalf_of_member_id" <> "transactions"."payer_member_id" AND "transactions"."on_behalf_of_member_id" <> "transactions"."receiving_member_id"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_linked_transaction" CHECK ("transactions"."linked_transaction_id" IS NULL OR ("transactions"."type" = 'SETTLEMENT' AND "transactions"."linked_transaction_id" <> "transactions"."id"));