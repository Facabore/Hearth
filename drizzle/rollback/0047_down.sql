-- Rollback of drizzle/0047_p342_plan_currencies.sql (P342 T6, S7, issue #341). NOT in the journal: the owner runs it by
-- hand, only together with deploying an app from before P342 T6, and only while 0047 is the last migration applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0047_down.sql
-- An app from before T6 knows one planned amount, capacity and FIXED value per line or member, in the space's
-- currency. This rollback runs only while every plan still fits that shape: it refuses, and changes nothing, when a
-- current line plans anything but exactly one budget in its space's currency, or when a capacity or a
-- FIXED value (superseded ones too) is in another currency, counting each in the error. Otherwise it gives every line
-- its planned_amount back from its space-currency budget (removed lines from their last one), sets it NOT NULL again,
-- renames budget_line_budgets to p342_s7_line_budgets_backup (nothing is dropped), drops the currency columns (every
-- value in them is its space's currency, so nothing is lost), restores the former keys and forgets 0047 in
-- drizzle.__drizzle_migrations so a later deploy applies it again.
BEGIN;

LOCK TABLE "spaces", "budget_plans", "budget_lines", "budget_member_capacities", "budget_allocations",
	"budget_line_budgets" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
	lines integer;
	capacities integer;
	fixed_values integer;
BEGIN
	IF to_regclass('public.p342_s7_line_budgets_backup') IS NOT NULL THEN
		RAISE EXCEPTION 'P342 S7 rollback: p342_s7_line_budgets_backup already exists; rename it before rolling back again';
	END IF;
	SELECT count(*) INTO lines FROM (
		SELECT l."id"
		FROM "budget_lines" l
		JOIN "budget_plans" p ON p."id" = l."plan_id"
		JOIN "spaces" s ON s."id" = p."space_id"
		LEFT JOIN "budget_line_budgets" b ON b."line_id" = l."id" AND b."removed_at" IS NULL
		WHERE l."deleted_at" IS NULL
		GROUP BY l."id", s."currency"
		HAVING count(b."id") <> 1 OR bool_or(b."currency" IS DISTINCT FROM s."currency")
	) multi;
	SELECT count(*) INTO capacities
	FROM "budget_member_capacities" c
	JOIN "budget_plans" p ON p."id" = c."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	WHERE c."currency" <> s."currency";
	SELECT count(*) INTO fixed_values
	FROM "budget_allocations" a
	JOIN "budget_lines" l ON l."id" = a."line_id"
	JOIN "budget_plans" p ON p."id" = l."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	WHERE a."currency" IS NOT NULL AND a."currency" <> s."currency";
	IF lines + capacities + fixed_values > 0 THEN
		RAISE EXCEPTION 'P342 S7 rollback: % lines, % capacities and % FIXED values use several currencies or none in the space''s; an app from before T6 cannot read them',
			lines, capacities, fixed_values;
	END IF;
END
$$;

-- Each line's planned amount is its budget in its space's currency: the current one, else (a removed line, or one whose
-- budget was ended) the last one it had.
UPDATE "budget_lines" l SET "planned_amount" = latest."planned_amount"
FROM (
	SELECT DISTINCT ON (b."line_id") b."line_id", b."planned_amount"
	FROM "budget_line_budgets" b
	JOIN "budget_plans" p ON p."id" = b."plan_id"
	JOIN "spaces" s ON s."id" = p."space_id"
	WHERE b."currency" = s."currency"
	ORDER BY b."line_id", (b."removed_at" IS NULL) DESC, b."updated_at" DESC
) latest
WHERE latest."line_id" = l."id";

DO $$
DECLARE
	missing integer;
BEGIN
	SELECT count(*) INTO missing FROM "budget_lines" WHERE "planned_amount" IS NULL;
	IF missing > 0 THEN
		RAISE EXCEPTION 'P342 S7 rollback: % removed lines never had a budget in their space''s currency', missing;
	END IF;
END
$$;

ALTER TABLE "budget_lines" ALTER COLUMN "planned_amount" SET NOT NULL;

ALTER TABLE "budget_line_budgets" RENAME TO "p342_s7_line_budgets_backup";
ALTER TABLE "p342_s7_line_budgets_backup" RENAME CONSTRAINT "budget_line_budgets_pkey" TO "p342_s7_line_budgets_backup_pkey";
ALTER TABLE "p342_s7_line_budgets_backup" DROP CONSTRAINT "budget_line_budgets_line_plan_fk";
ALTER TABLE "p342_s7_line_budgets_backup" DROP CONSTRAINT "budget_line_budgets_plan_id_budget_plans_id_fk";
ALTER TABLE "p342_s7_line_budgets_backup" DROP CONSTRAINT "budget_line_budgets_planned_positive";
DROP INDEX "budget_line_budgets_current_uq";
DROP INDEX "budget_line_budgets_plan_idx";

ALTER TABLE "budget_allocations" DROP CONSTRAINT "budget_allocations_currency";
DROP INDEX "budget_allocations_current_uq";
ALTER TABLE "budget_allocations" DROP COLUMN "currency";
CREATE UNIQUE INDEX "budget_allocations_current_uq" ON "budget_allocations" USING btree ("line_id","member_id") WHERE "budget_allocations"."superseded_at" IS NULL;

ALTER TABLE "budget_member_capacities" DROP CONSTRAINT "budget_member_capacities_plan_id_member_id_currency_pk";
ALTER TABLE "budget_member_capacities" DROP COLUMN "currency";
ALTER TABLE "budget_member_capacities" ADD CONSTRAINT "budget_member_capacities_plan_id_member_id_pk" PRIMARY KEY("plan_id","member_id");

DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795049362761;

COMMIT;
