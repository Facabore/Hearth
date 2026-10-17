ALTER TABLE "accounts" ADD COLUMN "institution" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_four" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last_four" CHECK ("accounts"."last_four" ~ '^[0-9]{4}$');