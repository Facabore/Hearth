-- #249, M3A-3: a category mapping's plan_id, copied from its line for the one-current-line-per-plan index, must equal
-- that line's plan. The single-column key on line_id becomes a composite one on (line_id, plan_id), which points at
-- the new unique key (id, plan_id) of budget_lines. Forward-only: no row is rewritten or deleted. The block below reads
-- the existing mappings first and stops the migration, naming them, if any names another plan than its line's.
-- drizzle-kit generated the statements after it; they are reordered by hand so the unique key exists before the
-- foreign key that needs it.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(bad."id"::text, ', ') INTO found
  FROM (SELECT m."id" FROM "budget_line_categories" m JOIN "budget_lines" l ON l."id" = m."line_id"
        WHERE l."plan_id" <> m."plan_id" ORDER BY m."id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0023_line_category_plan: budget_line_categories whose plan_id is not their line''s plan: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_id_plan_uq" UNIQUE("id","plan_id");--> statement-breakpoint
ALTER TABLE "budget_line_categories" ADD CONSTRAINT "budget_line_categories_line_plan_fk" FOREIGN KEY ("line_id","plan_id") REFERENCES "public"."budget_lines"("id","plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_line_categories" DROP CONSTRAINT "budget_line_categories_line_id_budget_lines_id_fk";
