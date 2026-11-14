-- D26 (#316): a plan line may name the members who usually pay it, for every period or for its own only. Forward-only
-- and additive: two columns and checks; no row is rewritten or deleted. An existing line reads as before: no payers
-- (the empty default) and no scope.
ALTER TABLE "budget_lines" ADD COLUMN "payer_member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD COLUMN "payers_scope" text;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_payers_scope" CHECK (("budget_lines"."payers_scope" IS NULL) = (cardinality("budget_lines"."payer_member_ids") = 0));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_payers_scope_value" CHECK ("budget_lines"."payers_scope" IN ('EVERY_PERIOD', 'THIS_PERIOD'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_savings_payers" CHECK (NOT ("budget_lines"."funding" = 'SAVINGS' AND cardinality("budget_lines"."payer_member_ids") > 0));