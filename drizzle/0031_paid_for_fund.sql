-- D26 (#316): an expense paid for the fund is the fund's payment of it linked to the member's contribution to the fund,
-- both ways, like P322's gift. Forward-only: the check on linked_transaction_id is replaced by a wider one that also
-- lets an EXPENSE and a fund contribution (a TRANSFER with a payer member) point at their other half. Every stored row
-- met the old check, which the new one includes, so none is rewritten.
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_linked_transaction";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_linked_transaction" CHECK ("transactions"."linked_transaction_id" IS NULL OR ("transactions"."linked_transaction_id" <> "transactions"."id" AND ("transactions"."type" = 'SETTLEMENT' OR "transactions"."type" = 'EXPENSE' OR ("transactions"."type" = 'TRANSFER' AND "transactions"."payer_member_id" IS NOT NULL))));