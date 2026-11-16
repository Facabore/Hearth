-- D29, slice MC3: every account gets its own currency (ISO 4217). Forward-only and additive: one new column, no row is
-- deleted or rewritten beyond the back-fill below. The column is added nullable, back-filled with each account's space
-- currency (D6: a space has exactly one, so the sub-select returns one row per account), then set NOT NULL. Every
-- existing and new account keeps its space's currency; a later slice lets a person pick a different one.
ALTER TABLE "accounts" ADD COLUMN "currency" text;--> statement-breakpoint
UPDATE "accounts" SET "currency" = (SELECT "currency" FROM "spaces" WHERE "spaces"."id" = "accounts"."space_id");--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "currency" SET NOT NULL;
