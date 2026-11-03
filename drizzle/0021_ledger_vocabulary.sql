-- #249, M1-9: the closed vocabularies of accounts.type, shares.split_method and transaction_audit.action become CHECKs,
-- and a transaction holds one share per member. Forward-only and additive: no row is rewritten or deleted. The block
-- below reads the existing rows first and stops the migration, naming the rows, if any of them breaks a new
-- constraint; such a row was written outside the app and has to be corrected by hand before migrating again.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg("id"::text || ' (' || "type" || ')', ', ') INTO found
  FROM (SELECT "id", "type" FROM "accounts"
        WHERE "type" NOT IN ('CASH', 'BANK', 'WALLET', 'CREDIT_CARD', 'SAVINGS', 'INVESTMENT', 'LOAN', 'OTHER', 'SHARED_FUND')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0021_ledger_vocabulary: accounts with a type outside ACCOUNT_TYPES: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("transaction_id"::text || '/' || "position" || ' (' || "split_method" || ')', ', ') INTO found
  FROM (SELECT "transaction_id", "position", "split_method" FROM "shares"
        WHERE "split_method" NOT IN ('EQUAL', 'PERCENT', 'EXACT', 'SHARES', 'BY_ALLOCATION')
        ORDER BY "transaction_id", "position" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0021_ledger_vocabulary: shares with an unknown split_method: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("transaction_id"::text || '/' || "member_id", ', ') INTO found
  FROM (SELECT "transaction_id", "member_id" FROM "shares" GROUP BY "transaction_id", "member_id" HAVING count(*) > 1
        ORDER BY "transaction_id", "member_id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0021_ledger_vocabulary: transactions with two shares for one member (transaction/member): %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
  SELECT string_agg("id"::text || ' (' || "action" || ')', ', ') INTO found
  FROM (SELECT "id", "action" FROM "transaction_audit" WHERE "action" NOT IN ('UPDATED', 'DELETED', 'RESTORED')
        ORDER BY "id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0021_ledger_vocabulary: transaction_audit entries with an unknown action: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_transaction_member_uq" ON "shares" USING btree ("transaction_id","member_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_type" CHECK ("accounts"."type" IN ('CASH', 'BANK', 'WALLET', 'CREDIT_CARD', 'SAVINGS', 'INVESTMENT', 'LOAN', 'OTHER', 'SHARED_FUND'));--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_split_method" CHECK ("shares"."split_method" IN ('EQUAL', 'PERCENT', 'EXACT', 'SHARES', 'BY_ALLOCATION'));--> statement-breakpoint
ALTER TABLE "transaction_audit" ADD CONSTRAINT "transaction_audit_action" CHECK ("transaction_audit"."action" IN ('UPDATED', 'DELETED', 'RESTORED'));