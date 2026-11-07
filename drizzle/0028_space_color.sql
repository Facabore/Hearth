-- #268, ruling P306: a space may carry the color a manager chose for it. Forward-only and additive: one nullable
-- column, no row is rewritten or deleted. A null color shows the one derived from the space id, so every existing
-- space keeps a color without a backfill.
ALTER TABLE "spaces" ADD COLUMN "color" text;