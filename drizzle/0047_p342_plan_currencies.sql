-- P342 T6 (S7, issue #341, owner: "Líneas por moneda", "Misma regla, por moneda"): a plan line holds one budget per
-- currency, capacities are per member and currency, and a FIXED allocation value belongs to one budget's currency.
-- Nothing converts: every existing amount becomes a row in its space's currency with exactly the value it had.
--   * budget_line_budgets: one row per budget_lines row (removed lines too, D8) in its space's currency with its
--     planned_amount; budget_lines.planned_amount stays with its values (only NOT NULL is dropped) and is read by
--     nothing from now on, so drizzle/rollback/0047_down.sql can give an app from before T6 its column back.
--   * budget_member_capacities.currency: the space's, for every row; the key becomes (plan, member, currency).
--   * budget_allocations.currency: the space's for every FIXED row (superseded ones too), null for PERCENT ones.
-- Nothing is deleted. Runs inside the migrator's single transaction: a failed self-check leaves everything as it was.
LOCK TABLE "spaces", "budget_plans", "budget_lines", "budget_member_capacities", "budget_allocations"
	IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE "budget_line_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"planned_amount" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "budget_line_budgets_planned_positive" CHECK ("budget_line_budgets"."planned_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "budget_line_budgets" ADD CONSTRAINT "budget_line_budgets_plan_id_budget_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_budgets" ADD CONSTRAINT "budget_line_budgets_line_plan_fk" FOREIGN KEY ("line_id","plan_id") REFERENCES "public"."budget_lines"("id","plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_line_budgets_current_uq" ON "budget_line_budgets" USING btree ("line_id","currency") WHERE "budget_line_budgets"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "budget_line_budgets_plan_idx" ON "budget_line_budgets" USING btree ("plan_id");--> statement-breakpoint
-- Every line, removed ones included, plans its planned_amount in its space's currency, as it did before.
INSERT INTO "budget_line_budgets" ("plan_id", "line_id", "currency", "planned_amount", "position", "created_at", "updated_at")
SELECT l."plan_id", l."id", s."currency", l."planned_amount", 0, l."created_at", l."updated_at"
FROM "budget_lines" l
JOIN "budget_plans" p ON p."id" = l."plan_id"
JOIN "spaces" s ON s."id" = p."space_id";
--> statement-breakpoint
ALTER TABLE "budget_lines" ALTER COLUMN "planned_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_member_capacities" ADD COLUMN "currency" text;--> statement-breakpoint
UPDATE "budget_member_capacities" c SET "currency" = s."currency"
FROM "budget_plans" p JOIN "spaces" s ON s."id" = p."space_id"
WHERE p."id" = c."plan_id";
--> statement-breakpoint
ALTER TABLE "budget_member_capacities" ALTER COLUMN "currency" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_member_capacities" DROP CONSTRAINT "budget_member_capacities_plan_id_member_id_pk";--> statement-breakpoint
ALTER TABLE "budget_member_capacities" ADD CONSTRAINT "budget_member_capacities_plan_id_member_id_currency_pk" PRIMARY KEY("plan_id","member_id","currency");--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD COLUMN "currency" text;--> statement-breakpoint
UPDATE "budget_allocations" a SET "currency" = s."currency"
FROM "budget_lines" l JOIN "budget_plans" p ON p."id" = l."plan_id" JOIN "spaces" s ON s."id" = p."space_id"
WHERE l."id" = a."line_id" AND a."rule" = 'FIXED';
--> statement-breakpoint
DROP INDEX "budget_allocations_current_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocations_current_uq" ON "budget_allocations" USING btree ("line_id","member_id",coalesce("currency", '')) WHERE "budget_allocations"."superseded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_currency" CHECK (("budget_allocations"."rule" = 'FIXED') = ("budget_allocations"."currency" IS NOT NULL));--> statement-breakpoint
-- Self-check before commit: every line has exactly one budget, in its space's currency, equal to its planned_amount;
-- every capacity and every FIXED value is in its space's currency, and no PERCENT value has one.
DO $$
DECLARE
	bad record;
BEGIN
	SELECT l."id", count(b."id") AS budgets INTO bad
	FROM "budget_lines" l
	JOIN "budget_plans" p ON p."id" = l."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	LEFT JOIN "budget_line_budgets" b ON b."line_id" = l."id"
	GROUP BY l."id", l."planned_amount", s."currency"
	HAVING count(b."id") <> 1
		OR bool_or(b."currency" IS DISTINCT FROM s."currency" OR b."planned_amount" IS DISTINCT FROM l."planned_amount")
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S7: line % does not plan exactly its planned_amount in its space''s currency (% budgets)',
			bad."id", bad."budgets";
	END IF;
	SELECT c."plan_id", c."member_id" INTO bad
	FROM "budget_member_capacities" c
	JOIN "budget_plans" p ON p."id" = c."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	WHERE c."currency" IS DISTINCT FROM s."currency"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S7: the capacity of member % in plan % is not in its space''s currency',
			bad."member_id", bad."plan_id";
	END IF;
	SELECT a."id" INTO bad
	FROM "budget_allocations" a
	JOIN "budget_lines" l ON l."id" = a."line_id"
	JOIN "budget_plans" p ON p."id" = l."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	WHERE (a."rule" = 'FIXED' AND a."currency" IS DISTINCT FROM s."currency")
		OR (a."rule" = 'PERCENT' AND a."currency" IS NOT NULL)
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S7: allocation value % is not in its line''s space currency', bad."id";
	END IF;
END
$$;
