-- #249, M1-8, ruling P288: a transaction's category, receiving member and payer member belong to its space. Each
-- single-column foreign key becomes a composite one on (column, space_id), which points at the unique keys
-- (id, space_id) of categories (new here) and space_members (from 0024); a null column still passes (MATCH SIMPLE). The accounts keep their
-- single-column keys: D9 lets a fund contribution or a settlement move money through a member's personal account.
-- Forward-only: no row is rewritten or deleted. The block below reads the existing rows first and stops the migration,
-- naming the transactions, if any of them points into another space. drizzle-kit generated the statements after it;
-- they are reordered by hand so the unique key exists before the foreign keys that need it.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(bad."id"::text, ', ') INTO found
  FROM (SELECT t."id" FROM "transactions" t JOIN "categories" c ON c."id" = t."category_id"
        WHERE c."space_id" <> t."space_id" ORDER BY t."id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0025_transaction_space_keys: transactions whose category belongs to another space: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg(bad."id"::text, ', ') INTO found
  FROM (SELECT t."id" FROM "transactions" t JOIN "space_members" m ON m."id" = t."receiving_member_id"
        WHERE m."space_id" <> t."space_id" ORDER BY t."id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0025_transaction_space_keys: transactions whose receiving member belongs to another space: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg(bad."id"::text, ', ') INTO found
  FROM (SELECT t."id" FROM "transactions" t JOIN "space_members" m ON m."id" = t."payer_member_id"
        WHERE m."space_id" <> t."space_id" ORDER BY t."id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0025_transaction_space_keys: transactions whose payer member belongs to another space: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_space_uq" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_space_fk" FOREIGN KEY ("category_id","space_id") REFERENCES "public"."categories"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiving_member_space_fk" FOREIGN KEY ("receiving_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payer_member_space_fk" FOREIGN KEY ("payer_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_receiving_member_id_space_members_id_fk";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_payer_member_id_space_members_id_fk";
