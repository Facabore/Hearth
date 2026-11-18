-- P342 S8 dry run for migration 0045 (issue #341). Read-only: run it on staging and production before deploying 0045,
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/p342-dry-run.sql
-- Every "must be 0" query below must return 0 (or no rows); otherwise 0045 would RAISE and change nothing, and the
-- rows it names need a look first. Take a backup (pg_dump) right before the deploy that runs 0045 as well.
BEGIN TRANSACTION READ ONLY;

-- 1. The movements 0045 converts, by type, live or deleted, stored currency and original currency.
SELECT t.type, t.deleted_at IS NULL AS live, t.currency, t.original_currency, count(*) AS movements
FROM transactions t
WHERE t.original_amount IS NOT NULL OR t.original_currency IS NOT NULL
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2 DESC, 3, 4;

-- 2. Incomes whose destination leg was stored without its currency (0045 fills it from the account's), by whether
--    they also have an original.
SELECT t.original_amount IS NOT NULL AS has_original, t.deleted_at IS NULL AS live, count(*) AS incomes
FROM transactions t
WHERE t.type = 'INCOME' AND t.destination_amount IS NOT NULL AND t.destination_currency IS NULL
GROUP BY 1, 2
ORDER BY 1, 2 DESC;

-- 3. Converted expenses with several payments, several shares, and shares not split EQUAL (re-split by their old
--    proportions, since a split's percentages, units or exact amounts were never stored).
SELECT
	count(*) FILTER (WHERE (SELECT count(*) FROM payments p WHERE p.transaction_id = t.id) > 1) AS multi_payment,
	count(*) FILTER (WHERE (SELECT count(*) FROM shares s WHERE s.transaction_id = t.id) > 1) AS multi_share,
	count(*) FILTER (WHERE EXISTS (SELECT 1 FROM shares s WHERE s.transaction_id = t.id AND s.split_method <> 'EQUAL'))
		AS not_equal_split
FROM transactions t
WHERE t.type = 'EXPENSE' AND t.original_amount IS NOT NULL;

-- 4. Precondition, must be 0: a payment without a leg whose account is in another currency than the row's (the
--    account then moved the row's base amount as a number in its own currency).
SELECT count(*) AS payments_without_leg_in_another_currency
FROM payments p
JOIN transactions t ON t.id = p.transaction_id
JOIN accounts a ON a.id = p.account_id
WHERE p.account_amount IS NULL AND a.currency <> t.currency;

-- 5. The same precondition for source and destination legs, must be 0.
SELECT count(*) AS legs_missing_in_another_currency
FROM transactions t
LEFT JOIN accounts src ON src.id = t.source_account_id
LEFT JOIN accounts dst ON dst.id = t.destination_account_id
WHERE (t.type <> 'INCOME' AND t.source_amount IS NULL AND src.currency <> t.currency)
	OR (t.destination_amount IS NULL AND dst.currency <> t.currency);

-- 6. Must be 0 (0045 RAISEs): an account in the original currency whose leg is not the original amount (it would
--    have to move a different amount than it did).
SELECT t.id, t.type, t.original_amount, t.original_currency,
	coalesce(t.source_amount, t.amount) AS source_moved, coalesce(t.destination_amount, t.amount) AS destination_moved
FROM transactions t
LEFT JOIN accounts src ON src.id = t.source_account_id AND t.type <> 'INCOME'
LEFT JOIN accounts dst ON dst.id = t.destination_account_id
WHERE t.type <> 'EXPENSE' AND t.original_amount IS NOT NULL
	AND ((src.currency = t.original_currency AND coalesce(t.source_amount, t.amount) <> t.original_amount)
		OR (dst.currency = t.original_currency AND coalesce(t.destination_amount, t.amount) <> t.original_amount));

-- 7. Must be 0 (0045 RAISEs): an expense whose payments from accounts in the original currency moved more than the
--    original, or, when every payment is one of those, not exactly the original.
SELECT t.id, t.original_amount, t.original_currency, f.fixed, f.others
FROM transactions t
CROSS JOIN LATERAL (
	SELECT coalesce(sum(coalesce(p.account_amount, p.amount)) FILTER (WHERE a.currency = t.original_currency), 0) AS fixed,
		count(*) FILTER (WHERE a.currency IS DISTINCT FROM t.original_currency) AS others,
		count(*) AS payments
	FROM payments p LEFT JOIN accounts a ON a.id = p.account_id
	WHERE p.transaction_id = t.id
) f
WHERE t.type = 'EXPENSE' AND t.original_amount IS NOT NULL AND f.payments > 0
	AND ((f.others = 0 AND f.fixed <> t.original_amount) OR (f.others > 0 AND f.fixed >= t.original_amount));

-- 8. Must be 0 (0045's new CHECKs would fail): rows 0045 does not convert whose leg is in the row's own currency, and
--    legacy incomes whose account is in the row's currency but whose leg is not the amount.
SELECT count(*) AS legs_in_own_currency
FROM transactions t
LEFT JOIN accounts dst ON dst.id = t.destination_account_id
WHERE t.original_amount IS NULL
	AND (t.source_currency = t.currency
		OR t.destination_currency = t.currency
		OR (t.type = 'INCOME' AND t.destination_amount IS NOT NULL AND t.destination_currency IS NULL
			AND dst.currency = t.currency AND t.destination_amount <> t.amount));

-- 9. For information: movements already recorded in another currency than their space's (the new write path, P342 T3).
SELECT t.type, t.currency, s.currency AS space_currency, count(*) AS movements
FROM transactions t JOIN spaces s ON s.id = t.space_id
WHERE t.original_amount IS NULL AND t.currency <> s.currency
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

ROLLBACK;
