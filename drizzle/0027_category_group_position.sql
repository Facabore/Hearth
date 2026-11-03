-- #240, ruling P296: a space's category groups keep their own order, which people change one place at a time.
-- Forward-only and additive: no row is deleted, and only the new column is written. drizzle-kit generated the column
-- as NOT NULL in one statement, which existing rows would refuse; it is split by hand: the column is added nullable,
-- every space's groups (archived ones included) are numbered from 0 in the order the API listed them until now (by
-- name, as the list sorted with localeCompare "es", so the ICU Spanish collation, then by id), and only then is it
-- made NOT NULL and given its unique place and its check. Numbers that row_number() hands out per space are dense
-- and unique by construction, so no existing row can break the new constraints and there is no pre-check.
ALTER TABLE "category_groups" ADD COLUMN "position" integer;--> statement-breakpoint
UPDATE "category_groups" g SET "position" = numbered."position"
FROM (SELECT "id", (row_number() OVER (PARTITION BY "space_id" ORDER BY "name" COLLATE "es-x-icu", "id") - 1)::integer AS "position"
      FROM "category_groups") AS numbered
WHERE numbered."id" = g."id";--> statement-breakpoint
ALTER TABLE "category_groups" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_space_position_uq" UNIQUE("space_id","position");--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_position_non_negative" CHECK ("category_groups"."position" >= 0);
