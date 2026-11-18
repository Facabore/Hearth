-- Rollback of drizzle/0045_p342_own_currency.sql (P342 S8, issue #341). NOT in the journal: the owner runs it by hand,
-- only together with deploying an app from before P342 T3, and only while 0045 is the last migration applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/rollback/0045_down.sql
-- It restores every movement 0045 changed from p342_s8_backup (amount, currency, original, legs, payments, shares,
-- updated_at and version), appends one audit row per movement mirroring 0045's, drops 0045's CHECKs and forgets 0045 in
-- drizzle.__drizzle_migrations so a later deploy applies it again. It refuses (and changes nothing) when a movement was
-- edited after 0045, and skips the ones already restored, so running it twice changes nothing. Movements recorded after
-- 0045 in a currency other than their space's cannot go back to the old shape; it counts them in a NOTICE.
BEGIN;

LOCK TABLE "accounts", "transactions", "payments", "shares" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
	IF to_regclass('public.p342_s8_backup') IS NULL THEN
		RAISE EXCEPTION 'P342 S8 rollback: p342_s8_backup does not exist; 0045 never ran here';
	END IF;
END
$$;

-- 0045 raised each movement's version by one; one still there is restored, one back at its backed-up version already
-- was, and any other was edited since.
DROP TABLE IF EXISTS pg_temp.p342_restore;
CREATE TEMP TABLE p342_restore AS
SELECT b.* FROM "p342_s8_backup" b JOIN "transactions" t ON t."id" = b."transaction_id"
WHERE t."version" = (b."transaction"->>'version')::integer + 1;

DO $$
DECLARE
	edited uuid;
	foreign_rows bigint;
BEGIN
	SELECT t."id" INTO edited FROM "p342_s8_backup" b JOIN "transactions" t ON t."id" = b."transaction_id"
	WHERE t."version" NOT IN ((b."transaction"->>'version')::integer, (b."transaction"->>'version')::integer + 1)
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S8 rollback: movement % was edited after 0045; restore it by hand first', edited;
	END IF;
	SELECT count(*) INTO foreign_rows FROM "transactions" t JOIN "spaces" s ON s."id" = t."space_id"
	WHERE t."currency" <> s."currency" AND t."id" NOT IN (SELECT "transaction_id" FROM "p342_s8_backup");
	IF foreign_rows > 0 THEN
		RAISE NOTICE 'P342 S8 rollback: % movements recorded after 0045 are in another currency than their space''s; the old app reads them as the space''s', foreign_rows;
	END IF;
END
$$;

ALTER TABLE "transactions"
	DROP CONSTRAINT IF EXISTS "transactions_no_original",
	DROP CONSTRAINT IF EXISTS "transactions_source_leg_other_currency",
	DROP CONSTRAINT IF EXISTS "transactions_destination_leg_other_currency",
	DROP CONSTRAINT IF EXISTS "transactions_income_destination_currency";

-- Every change keeps its audit (D8): 0045's entry with each from and to swapped.
INSERT INTO "transaction_audit" ("id", "transaction_id", "action", "actor_user_id", "at", "changes")
SELECT gen_random_uuid(), a."transaction_id", 'UPDATED', 'system:migration-0045', now(),
	(SELECT jsonb_object_agg(c.key, jsonb_build_object('from', c.value->'to', 'to', c.value->'from'))
	 FROM jsonb_each(a."changes") c)
FROM "transaction_audit" a
WHERE a."transaction_id" IN (SELECT "transaction_id" FROM p342_restore)
	AND a."actor_user_id" = 'system:migration-0045'
	AND a."changes"->'migration'->>'to' = '0045';

UPDATE "transactions" t
SET "amount" = (r."transaction"->>'amount')::bigint,
	"currency" = r."transaction"->>'currency',
	"original_amount" = (r."transaction"->>'original_amount')::bigint,
	"original_currency" = r."transaction"->>'original_currency',
	"source_amount" = (r."transaction"->>'source_amount')::bigint,
	"source_currency" = r."transaction"->>'source_currency',
	"destination_amount" = (r."transaction"->>'destination_amount')::bigint,
	"destination_currency" = r."transaction"->>'destination_currency',
	"updated_at" = (r."transaction"->>'updated_at')::timestamptz,
	"version" = (r."transaction"->>'version')::integer
FROM p342_restore r
WHERE t."id" = r."transaction_id";

-- 0045 changed payments and shares in place, at the same positions.
UPDATE "payments" p
SET "amount" = (x->>'amount')::bigint, "account_amount" = (x->>'account_amount')::bigint
FROM p342_restore r, jsonb_array_elements(r."payments") x
WHERE p."transaction_id" = r."transaction_id" AND p."position" = (x->>'position')::smallint;

UPDATE "shares" s
SET "amount" = (x->>'amount')::bigint
FROM p342_restore r, jsonb_array_elements(r."shares") x
WHERE s."transaction_id" = r."transaction_id" AND s."position" = (x->>'position')::smallint;

DROP TABLE pg_temp.p342_restore;

-- 0045's journal "when"; without its row the migrator applies 0045 again on the next deploy that carries it.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795031028179;

COMMIT;
