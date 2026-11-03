-- #240, ruling P295: a bank account may say which product it is, savings or checking, as board B1 07 reads
-- "Ahorros ···1203". Forward-only and additive: one nullable column and its CHECKs, no row is rewritten or deleted.
-- Every existing account starts with a null product type, which both CHECKs accept, so no pre-check can fail here.
ALTER TABLE "accounts" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_product_type" CHECK ("accounts"."product_type" IN ('SAVINGS_ACCOUNT', 'CHECKING_ACCOUNT'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_product_type_bank" CHECK ("accounts"."product_type" IS NULL OR "accounts"."type" = 'BANK');
