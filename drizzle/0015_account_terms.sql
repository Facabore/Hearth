ALTER TABLE "accounts" ADD COLUMN "credit_limit" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cut_off_day" smallint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "payment_day" smallint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "monthly_rate_ppm" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "annual_rate_ppm" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "term_days" smallint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "maturity_date" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "principal" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "term_months" smallint;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_card_terms" CHECK ("accounts"."type" = 'CREDIT_CARD' OR ("accounts"."credit_limit" IS NULL AND "accounts"."cut_off_day" IS NULL AND "accounts"."payment_day" IS NULL AND "accounts"."monthly_rate_ppm" IS NULL));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_annual_rate" CHECK ("accounts"."annual_rate_ppm" IS NULL OR "accounts"."type" IN ('SAVINGS', 'LOAN'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_loan_terms" CHECK ("accounts"."type" = 'LOAN' OR ("accounts"."principal" IS NULL AND "accounts"."term_months" IS NULL));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_term_deposit" CHECK (("accounts"."term_days" IS NULL) = ("accounts"."maturity_date" IS NULL) AND ("accounts"."term_days" IS NULL OR "accounts"."type" = 'SAVINGS'));--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_cut_off_day" CHECK ("accounts"."cut_off_day" IS NULL OR "accounts"."cut_off_day" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_payment_day" CHECK ("accounts"."payment_day" IS NULL OR "accounts"."payment_day" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_monthly_rate_range" CHECK ("accounts"."monthly_rate_ppm" IS NULL OR "accounts"."monthly_rate_ppm" BETWEEN 0 AND 1000000);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_annual_rate_range" CHECK ("accounts"."annual_rate_ppm" IS NULL OR "accounts"."annual_rate_ppm" BETWEEN 0 AND 1000000);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_term_days_range" CHECK ("accounts"."term_days" IS NULL OR "accounts"."term_days" BETWEEN 1 AND 3660);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_term_months_range" CHECK ("accounts"."term_months" IS NULL OR "accounts"."term_months" BETWEEN 1 AND 480);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credit_limit_positive" CHECK ("accounts"."credit_limit" IS NULL OR "accounts"."credit_limit" > 0);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_principal_positive" CHECK ("accounts"."principal" IS NULL OR "accounts"."principal" > 0);