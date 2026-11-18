-- P342 (S8, issue #341): every movement that stored a base amount converted into its space's currency goes back to the
-- amount it was entered in. amount/currency := original_amount/original_currency; payments and shares are re-split in
-- that currency with Money.allocate's rule; each account leg keeps exactly what the account moved, so no account's
-- balance changes; original_* are nulled and CHECKs keep them null. Rows deleted logically are converted too (D8).
-- Runs inside the migrator's single transaction (or a script's implicit one): any RAISE leaves everything as it was.
-- Re-running it changes nothing. drizzle/rollback/0045_down.sql undoes it from p342_s8_backup.
LOCK TABLE "accounts", "transactions", "payments", "shares" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "p342_s8_backup" (
	"transaction_id" uuid PRIMARY KEY,
	"transaction" jsonb NOT NULL,
	"payments" jsonb NOT NULL,
	"shares" jsonb NOT NULL,
	"backed_up_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Money.allocate (src/shared/kernel/money.ts) in SQL: largest remainder in rounding units, ties to the earlier position,
-- a sub-unit remainder to the first part, a negative total split as its absolute value and negated. Weights are
-- non-negative integers, not all zero. numeric keeps units * weight exact past bigint.
CREATE OR REPLACE FUNCTION pg_temp.p342_allocate(total bigint, weights numeric[], rounding_unit bigint)
RETURNS bigint[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
	n integer := coalesce(array_length(weights, 1), 0);
	total_weight numeric := 0;
	units numeric;
	sub_unit numeric;
	base numeric[] := '{}';
	remainders numeric[] := '{}';
	leftover numeric;
	parts bigint[] := '{}';
	r record;
	i integer;
BEGIN
	IF n = 0 THEN
		RAISE EXCEPTION 'P342 S8: allocate needs at least one weight';
	END IF;
	FOR i IN 1..n LOOP
		IF weights[i] IS NULL OR weights[i] < 0 OR weights[i] <> trunc(weights[i]) THEN
			RAISE EXCEPTION 'P342 S8: allocate weight % is not a non-negative integer', weights[i];
		END IF;
		total_weight := total_weight + weights[i];
	END LOOP;
	IF total_weight = 0 THEN
		RAISE EXCEPTION 'P342 S8: allocate weights add up to zero';
	END IF;
	IF total < 0 THEN
		RETURN ARRAY(
			SELECT -part FROM unnest(pg_temp.p342_allocate(-total, weights, rounding_unit)) WITH ORDINALITY AS a(part, k)
			ORDER BY k
		);
	END IF;
	units := div(total::numeric, rounding_unit::numeric);
	sub_unit := mod(total::numeric, rounding_unit::numeric);
	leftover := units;
	FOR i IN 1..n LOOP
		base[i] := div(units * weights[i], total_weight);
		remainders[i] := mod(units * weights[i], total_weight);
		leftover := leftover - base[i];
	END LOOP;
	FOR r IN
		SELECT k FROM unnest(remainders) WITH ORDINALITY AS a(remainder, k) ORDER BY remainder DESC, k
	LOOP
		EXIT WHEN leftover <= 0;
		base[r.k] := base[r.k] + 1;
		leftover := leftover - 1;
	END LOOP;
	FOR i IN 1..n LOOP
		parts[i] := (base[i] * rounding_unit + CASE WHEN i = 1 THEN sub_unit ELSE 0 END)::bigint;
	END LOOP;
	RETURN parts;
END
$$;
--> statement-breakpoint
-- The rows this migration changes: every one with an original, and every income whose destination leg was stored
-- without its currency (before 0037 an income's leg kept none).
DROP TABLE IF EXISTS pg_temp.p342_touched;
--> statement-breakpoint
CREATE TEMP TABLE p342_touched AS
SELECT "id" FROM "transactions"
WHERE "original_amount" IS NOT NULL
	OR "original_currency" IS NOT NULL
	OR ("type" = 'INCOME' AND "destination_amount" IS NOT NULL AND "destination_currency" IS NULL);
--> statement-breakpoint
INSERT INTO "p342_s8_backup" ("transaction_id", "transaction", "payments", "shares")
SELECT t."id",
	to_jsonb(t),
	coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."position") FROM "payments" p WHERE p."transaction_id" = t."id"), '[]'),
	coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."position") FROM "shares" s WHERE s."transaction_id" = t."id"), '[]')
FROM "transactions" t
WHERE t."id" IN (SELECT "id" FROM p342_touched)
ON CONFLICT ("transaction_id") DO NOTHING;
--> statement-breakpoint
-- What each touched movement moves each account by, the figure netMovements (drizzle-ledger-queries.ts) sums:
-- coalesce(leg, amount), out negated.
CREATE OR REPLACE TEMP VIEW p342_moves AS
SELECT "transaction_id", "account_id", sum("moved") AS "moved" FROM (
	SELECT t."id" AS "transaction_id", t."destination_account_id" AS "account_id",
		coalesce(t."destination_amount", t."amount")::numeric AS "moved"
	FROM "transactions" t WHERE t."destination_account_id" IS NOT NULL
	UNION ALL
	SELECT t."id", t."source_account_id", -coalesce(t."source_amount", t."amount")::numeric
	FROM "transactions" t WHERE t."source_account_id" IS NOT NULL
	UNION ALL
	SELECT p."transaction_id", p."account_id", -coalesce(p."account_amount", p."amount")::numeric
	FROM "payments" p WHERE p."account_id" IS NOT NULL
) m
WHERE "transaction_id" IN (SELECT "id" FROM p342_touched)
GROUP BY "transaction_id", "account_id";
--> statement-breakpoint
-- Each account's figure over every movement, live and deleted apart (a restore brings a deleted one back).
CREATE OR REPLACE TEMP VIEW p342_nets AS
SELECT "account_id", "live", sum("moved") AS "net" FROM (
	SELECT t."destination_account_id" AS "account_id", t."deleted_at" IS NULL AS "live",
		coalesce(t."destination_amount", t."amount")::numeric AS "moved"
	FROM "transactions" t WHERE t."destination_account_id" IS NOT NULL
	UNION ALL
	SELECT t."source_account_id", t."deleted_at" IS NULL, -coalesce(t."source_amount", t."amount")::numeric
	FROM "transactions" t WHERE t."source_account_id" IS NOT NULL
	UNION ALL
	SELECT p."account_id", t."deleted_at" IS NULL, -coalesce(p."account_amount", p."amount")::numeric
	FROM "payments" p JOIN "transactions" t ON t."id" = p."transaction_id" WHERE p."account_id" IS NOT NULL
) m
GROUP BY "account_id", "live";
--> statement-breakpoint
DROP TABLE IF EXISTS pg_temp.p342_moves_before;
--> statement-breakpoint
CREATE TEMP TABLE p342_moves_before AS SELECT * FROM p342_moves;
--> statement-breakpoint
DROP TABLE IF EXISTS pg_temp.p342_nets_before;
--> statement-breakpoint
CREATE TEMP TABLE p342_nets_before AS SELECT * FROM p342_nets;
--> statement-breakpoint
-- The audit's JSON of an expense's payments and shares, as the domain's auditedValues writes it (transaction.ts).
CREATE OR REPLACE FUNCTION pg_temp.p342_payments_json(tx uuid) RETURNS text LANGUAGE sql STABLE AS $$
	SELECT '[' || coalesce(string_agg(
		'{"memberId":' || coalesce(to_json(p."member_id"::text)::text, 'null')
		|| ',"accountId":' || coalesce(to_json(p."account_id"::text)::text, 'null')
		|| ',"amount":' || to_json(p."amount"::text)::text
		|| CASE WHEN p."account_amount" IS NOT NULL AND a."currency" IS NOT NULL
			THEN ',"accountAmount":' || to_json(p."account_amount"::text || ' ' || a."currency")::text ELSE '' END
		|| '}', ',' ORDER BY p."position"), '') || ']'
	FROM "payments" p LEFT JOIN "accounts" a ON a."id" = p."account_id"
	WHERE p."transaction_id" = tx
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.p342_shares_json(tx uuid) RETURNS text LANGUAGE sql STABLE AS $$
	SELECT '[' || coalesce(string_agg(
		'{"memberId":' || to_json(s."member_id"::text)::text
		|| ',"amount":' || to_json(s."amount"::text)::text
		|| ',"splitMethod":' || to_json(s."split_method")::text
		|| '}', ',' ORDER BY s."position"), '') || ']'
	FROM "shares" s
	WHERE s."transaction_id" = tx
$$;
--> statement-breakpoint
DO $$
DECLARE
	actor CONSTANT text := 'system:migration-0045';
	t record;
	p record;
	target_amount bigint;
	target_currency text;
	unit bigint;
	fixed_total numeric;
	free_positions smallint[];
	free_weights numeric[];
	weights numeric[];
	share_positions smallint[];
	parts bigint[];
	k integer;
	every_equal boolean;
	moved bigint;
	account_currency text;
	new_source_amount bigint;
	new_source_currency text;
	new_destination_amount bigint;
	new_destination_currency text;
	payments_before text;
	shares_before text;
	source_before text;
	destination_before text;
	source_after text;
	destination_after text;
	changes jsonb;
BEGIN
	FOR t IN
		SELECT x.* FROM "transactions" x WHERE x."id" IN (SELECT "id" FROM p342_touched) ORDER BY x."id"
	LOOP
		IF (t."original_amount" IS NULL) <> (t."original_currency" IS NULL) THEN
			RAISE EXCEPTION 'P342 S8: transaction % has an original amount without its currency, or the reverse', t."id";
		END IF;
		target_amount := coalesce(t."original_amount", t."amount");
		target_currency := coalesce(t."original_currency", t."currency");
		unit := CASE WHEN target_currency = 'COP' THEN 100 ELSE 1 END;
		changes := jsonb_build_object('migration', jsonb_build_object('from', NULL, 'to', '0045'));

		IF t."type" = 'EXPENSE' THEN
			payments_before := pg_temp.p342_payments_json(t."id");
			shares_before := pg_temp.p342_shares_json(t."id");
			-- A payment from an account in the movement's currency pays exactly what that account moved; the rest of the
			-- amount is split over the other payments by their old amounts.
			fixed_total := 0;
			free_positions := '{}';
			free_weights := '{}';
			FOR p IN
				SELECT y.*, a."currency" AS "account_currency" FROM "payments" y LEFT JOIN "accounts" a ON a."id" = y."account_id"
				WHERE y."transaction_id" = t."id" ORDER BY y."position"
			LOOP
				IF p."account_id" IS NOT NULL AND p."account_currency" = target_currency THEN
					fixed_total := fixed_total + coalesce(p."account_amount", p."amount");
				ELSE
					free_positions := free_positions || p."position";
					free_weights := free_weights || p."amount"::numeric;
				END IF;
			END LOOP;
			IF coalesce(array_length(free_positions, 1), 0) = 0 THEN
				IF fixed_total <> target_amount AND EXISTS (SELECT 1 FROM "payments" WHERE "transaction_id" = t."id") THEN
					RAISE EXCEPTION 'P342 S8: the payments of % moved % %, not its original %', t."id", fixed_total,
						target_currency, target_amount;
				END IF;
			ELSE
				IF target_amount - fixed_total <= 0 THEN
					RAISE EXCEPTION 'P342 S8: the payments in % of % already pay % of its original %', target_currency, t."id",
						fixed_total, target_amount;
				END IF;
				parts := pg_temp.p342_allocate((target_amount - fixed_total)::bigint, free_weights, unit);
			END IF;
			FOR p IN
				SELECT y.*, a."currency" AS "account_currency" FROM "payments" y LEFT JOIN "accounts" a ON a."id" = y."account_id"
				WHERE y."transaction_id" = t."id" ORDER BY y."position"
			LOOP
				moved := coalesce(p."account_amount", p."amount");
				IF p."account_id" IS NOT NULL AND p."account_currency" = target_currency THEN
					UPDATE "payments" SET "amount" = moved, "account_amount" = NULL
					WHERE "transaction_id" = t."id" AND "position" = p."position";
				ELSE
					k := array_position(free_positions, p."position");
					UPDATE "payments"
					SET "amount" = parts[k], "account_amount" = CASE WHEN p."account_id" IS NULL THEN NULL ELSE moved END
					WHERE "transaction_id" = t."id" AND "position" = p."position";
				END IF;
			END LOOP;
			-- Shares: an equal split again splits equally; any other method keeps its old proportions (its inputs, the
			-- percentages, units or exact amounts, were never stored).
			SELECT array_agg("position" ORDER BY "position"), bool_and("split_method" = 'EQUAL'),
				array_agg("amount"::numeric ORDER BY "position")
			INTO share_positions, every_equal, weights
			FROM "shares" WHERE "transaction_id" = t."id";
			IF share_positions IS NOT NULL THEN
				IF every_equal THEN
					weights := array_fill(1::numeric, ARRAY[array_length(share_positions, 1)]);
				END IF;
				parts := pg_temp.p342_allocate(target_amount, weights, unit);
				FOR k IN 1..array_length(share_positions, 1) LOOP
					UPDATE "shares" SET "amount" = parts[k] WHERE "transaction_id" = t."id" AND "position" = share_positions[k];
				END LOOP;
			END IF;
			IF pg_temp.p342_payments_json(t."id") <> payments_before THEN
				changes := changes || jsonb_build_object('payments',
					jsonb_build_object('from', payments_before, 'to', pg_temp.p342_payments_json(t."id")));
			END IF;
			IF pg_temp.p342_shares_json(t."id") <> shares_before THEN
				changes := changes || jsonb_build_object('shares',
					jsonb_build_object('from', shares_before, 'to', pg_temp.p342_shares_json(t."id")));
			END IF;
			new_source_amount := t."source_amount";
			new_source_currency := t."source_currency";
			new_destination_amount := t."destination_amount";
			new_destination_currency := t."destination_currency";
		ELSE
			-- Each account leg: none when the account is in the movement's currency (it then moves the amount itself, so
			-- what it moved must be the original), else exactly what it moved, in its own currency.
			new_source_amount := NULL;
			new_source_currency := NULL;
			IF t."type" <> 'INCOME' AND t."source_account_id" IS NOT NULL THEN
				SELECT a."currency" INTO account_currency FROM "accounts" a WHERE a."id" = t."source_account_id";
				moved := coalesce(t."source_amount", t."amount");
				IF account_currency = target_currency THEN
					IF moved <> target_amount THEN
						RAISE EXCEPTION 'P342 S8: the source account of % moved % %, not its original %', t."id", moved,
							account_currency, target_amount;
					END IF;
				ELSE
					new_source_amount := moved;
					new_source_currency := account_currency;
				END IF;
			ELSIF t."source_amount" IS NOT NULL THEN
				RAISE EXCEPTION 'P342 S8: transaction % has a source leg without a source account', t."id";
			END IF;
			new_destination_amount := NULL;
			new_destination_currency := NULL;
			IF t."destination_account_id" IS NOT NULL THEN
				SELECT a."currency" INTO account_currency FROM "accounts" a WHERE a."id" = t."destination_account_id";
				moved := coalesce(t."destination_amount", t."amount");
				IF account_currency = target_currency THEN
					IF moved <> target_amount THEN
						RAISE EXCEPTION 'P342 S8: the destination account of % moved % %, not its original %', t."id", moved,
							account_currency, target_amount;
					END IF;
				ELSE
					new_destination_amount := moved;
					new_destination_currency := account_currency;
				END IF;
			ELSIF t."destination_amount" IS NOT NULL THEN
				RAISE EXCEPTION 'P342 S8: transaction % has a destination leg without a destination account', t."id";
			END IF;
			-- The legs as the audit wrote them ("minor CODE"); an income's leg stored without its currency read as the
			-- row's original currency, else its own (transaction-rows.ts before 0045).
			source_before := CASE WHEN t."type" = 'INCOME' OR t."source_amount" IS NULL THEN NULL
				ELSE trim(t."source_amount"::text || ' ' || coalesce(t."source_currency", '')) END;
			destination_before := CASE WHEN t."destination_amount" IS NULL THEN NULL
				ELSE trim(t."destination_amount"::text || ' ' || coalesce(t."destination_currency",
					CASE WHEN t."type" = 'INCOME' THEN coalesce(t."original_currency", t."currency") ELSE '' END)) END;
			source_after := CASE WHEN new_source_amount IS NULL THEN NULL
				ELSE new_source_amount::text || ' ' || new_source_currency END;
			destination_after := CASE WHEN new_destination_amount IS NULL THEN NULL
				ELSE new_destination_amount::text || ' ' || new_destination_currency END;
			IF source_before IS DISTINCT FROM source_after THEN
				changes := changes || jsonb_build_object('sourceAmount',
					jsonb_build_object('from', source_before, 'to', source_after));
			END IF;
			IF destination_before IS DISTINCT FROM destination_after THEN
				changes := changes || jsonb_build_object('destinationAmount',
					jsonb_build_object('from', destination_before, 'to', destination_after));
			END IF;
		END IF;

		IF t."amount" <> target_amount THEN
			changes := changes || jsonb_build_object('amount',
				jsonb_build_object('from', t."amount"::text, 'to', target_amount::text));
		END IF;
		IF t."currency" <> target_currency THEN
			changes := changes || jsonb_build_object('currency',
				jsonb_build_object('from', t."currency", 'to', target_currency));
		END IF;
		IF t."original_amount" IS NOT NULL THEN
			changes := changes || jsonb_build_object('originalAmount',
				jsonb_build_object('from', t."original_amount"::text || ' ' || t."original_currency", 'to', NULL));
		END IF;

		UPDATE "transactions"
		SET "amount" = target_amount,
			"currency" = target_currency,
			"original_amount" = NULL,
			"original_currency" = NULL,
			"source_amount" = new_source_amount,
			"source_currency" = new_source_currency,
			"destination_amount" = new_destination_amount,
			"destination_currency" = new_destination_currency,
			"updated_at" = now(),
			"version" = "version" + 1
		WHERE "id" = t."id";
		INSERT INTO "transaction_audit" ("id", "transaction_id", "action", "actor_user_id", "at", "changes")
		VALUES (gen_random_uuid(), t."id", 'UPDATED', actor, now(), changes);
	END LOOP;
END
$$;
--> statement-breakpoint
-- Self-check before commit: every account moved exactly what it moved before, per movement and in total, and every
-- touched expense's payments and shares add up to its amount.
DO $$
DECLARE
	bad record;
BEGIN
	SELECT b."transaction_id", b."account_id", b."moved" AS "before", a."moved" AS "after" INTO bad
	FROM p342_moves_before b FULL JOIN p342_moves a USING ("transaction_id", "account_id")
	WHERE b."moved" IS DISTINCT FROM a."moved"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S8: transaction % now moves account % by % instead of %', bad."transaction_id",
			bad."account_id", bad."after", bad."before";
	END IF;
	SELECT b."account_id", b."live", b."net" AS "before", a."net" AS "after" INTO bad
	FROM p342_nets_before b FULL JOIN p342_nets a USING ("account_id", "live")
	WHERE b."net" IS DISTINCT FROM a."net"
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S8: account % (live: %) now nets % instead of %', bad."account_id", bad."live", bad."after",
			bad."before";
	END IF;
	SELECT t."id" INTO bad FROM "transactions" t
	WHERE t."id" IN (SELECT "id" FROM p342_touched) AND t."type" = 'EXPENSE' AND (
		(EXISTS (SELECT 1 FROM "payments" p WHERE p."transaction_id" = t."id")
			AND (SELECT sum(p."amount") FROM "payments" p WHERE p."transaction_id" = t."id") <> t."amount")
		OR (EXISTS (SELECT 1 FROM "shares" s WHERE s."transaction_id" = t."id")
			AND (SELECT sum(s."amount") FROM "shares" s WHERE s."transaction_id" = t."id") <> t."amount"))
	LIMIT 1;
	IF FOUND THEN
		RAISE EXCEPTION 'P342 S8: the payments or shares of % no longer add up to its amount', bad."id";
	END IF;
END
$$;
--> statement-breakpoint
DROP VIEW IF EXISTS pg_temp.p342_moves;
--> statement-breakpoint
DROP VIEW IF EXISTS pg_temp.p342_nets;
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.p342_payments_json(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.p342_shares_json(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS pg_temp.p342_allocate(bigint, numeric[], bigint);
--> statement-breakpoint
DROP TABLE IF EXISTS pg_temp.p342_touched, pg_temp.p342_moves_before, pg_temp.p342_nets_before;
--> statement-breakpoint
-- The CHECKs (mirrored in ledger.schema.ts); dropped first so a second run re-validates instead of failing.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_no_original",
	ADD CONSTRAINT "transactions_no_original" CHECK ("transactions"."original_amount" IS NULL AND "transactions"."original_currency" IS NULL);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_source_leg_other_currency",
	ADD CONSTRAINT "transactions_source_leg_other_currency" CHECK ("transactions"."source_currency" IS DISTINCT FROM "transactions"."currency");
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_destination_leg_other_currency",
	ADD CONSTRAINT "transactions_destination_leg_other_currency" CHECK ("transactions"."destination_currency" IS DISTINCT FROM "transactions"."currency");
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_income_destination_currency",
	ADD CONSTRAINT "transactions_income_destination_currency" CHECK ("transactions"."type" <> 'INCOME' OR "transactions"."destination_amount" IS NULL OR "transactions"."destination_currency" IS NOT NULL);
