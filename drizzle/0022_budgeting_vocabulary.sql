-- #249, M3A-2: the closed vocabularies of the budgeting text columns become CHECKs: budget_plans.status,
-- budget_lines.funding, rollover_mode and allocation_rule, and budget_allocations.rule. Forward-only and additive: no
-- row is rewritten or deleted. The block below reads the existing rows first and stops the migration, naming the rows,
-- if any of them breaks a new constraint; such a row has to be corrected by hand before migrating again.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg("id"::text || ' (' || "status" || ')', ', ') INTO found
  FROM (SELECT "id", "status" FROM "budget_plans" WHERE "status" NOT IN ('DRAFT', 'ACTIVE', 'CLOSED')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0022_budgeting_vocabulary: budget_plans with an unknown status: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("id"::text || ' (' || "funding" || ')', ', ') INTO found
  FROM (SELECT "id", "funding" FROM "budget_lines" WHERE "funding" NOT IN ('DIRECT', 'SHARED_FUND', 'SAVINGS')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0022_budgeting_vocabulary: budget_lines with an unknown funding: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("id"::text || ' (' || "rollover_mode" || ')', ', ') INTO found
  FROM (SELECT "id", "rollover_mode" FROM "budget_lines" WHERE "rollover_mode" NOT IN ('RESET', 'ROLLOVER', 'ADJUSTED')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0022_budgeting_vocabulary: budget_lines with an unknown rollover_mode: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("id"::text || ' (' || "allocation_rule" || ')', ', ') INTO found
  FROM (SELECT "id", "allocation_rule" FROM "budget_lines"
        WHERE "allocation_rule" NOT IN ('PROPORTIONAL', 'PERCENT', 'FIXED', 'NONE') ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0022_budgeting_vocabulary: budget_lines with an unknown allocation_rule: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("id"::text || ' (' || "rule" || ')', ', ') INTO found
  FROM (SELECT "id", "rule" FROM "budget_allocations" WHERE "rule" NOT IN ('PERCENT', 'FIXED')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0022_budgeting_vocabulary: budget_allocations with a rule other than PERCENT or FIXED: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_rule" CHECK ("budget_allocations"."rule" IN ('PERCENT', 'FIXED'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_funding" CHECK ("budget_lines"."funding" IN ('DIRECT', 'SHARED_FUND', 'SAVINGS'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_rollover_mode" CHECK ("budget_lines"."rollover_mode" IN ('RESET', 'ROLLOVER', 'ADJUSTED'));--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_allocation_rule" CHECK ("budget_lines"."allocation_rule" IN ('PROPORTIONAL', 'PERCENT', 'FIXED', 'NONE'));--> statement-breakpoint
ALTER TABLE "budget_plans" ADD CONSTRAINT "budget_plans_status" CHECK ("budget_plans"."status" IN ('DRAFT', 'ACTIVE', 'CLOSED'));