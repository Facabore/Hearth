ALTER TABLE "categories" ADD COLUMN "icon_kind" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "icon_value" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "category_groups" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "category_groups" ADD COLUMN "icon_kind" text DEFAULT 'SYMBOL' NOT NULL;--> statement-breakpoint
ALTER TABLE "category_groups" ADD COLUMN "icon_value" text DEFAULT 'tag' NOT NULL;--> statement-breakpoint
ALTER TABLE "category_groups" ADD COLUMN "color" text DEFAULT 'GRAPHITE' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_groups_space_key_uq" ON "category_groups" USING btree ("space_id","key");--> statement-breakpoint
-- HU-E3-05 back-fill, written by hand (rulings P56 and P77). It keys the seeded groups, then styles every row.
-- 1. A group takes the key of the catalog group whose seeded categories it holds: the one it holds the most of (the
--    first in catalog order on a tie). When several groups of a space claim one key, the group holding the most of
--    that catalog group's categories keeps it (the oldest on a tie) and the others stay keyless. Deleted categories
--    are not held.
WITH "held" AS (
  SELECT c."group_id", g."space_id", g."created_at", d."group_key", d."position", count(*) AS "n"
  FROM "categories" AS c
  JOIN "category_groups" AS g ON g."id" = c."group_id"
  JOIN (VALUES
    ('rent', 'housing', 1), ('utilities', 'housing', 1), ('maintenance', 'housing', 1),
    ('groceries', 'food', 2), ('restaurants', 'food', 2),
    ('fuel', 'transport', 3), ('public_transport', 'transport', 3),
    ('medical', 'health', 4), ('pharmacy', 'health', 4),
    ('entertainment', 'leisure', 5), ('travel', 'leisure', 5),
    ('salary', 'income', 6), ('other_income', 'income', 6)
  ) AS d ("category_key", "group_key", "position") ON d."category_key" = c."key"
  WHERE c."deleted_at" IS NULL
  GROUP BY c."group_id", g."space_id", g."created_at", d."group_key", d."position"
), "chosen" AS (
  SELECT DISTINCT ON ("group_id") "group_id", "space_id", "created_at", "group_key", "n"
  FROM "held"
  ORDER BY "group_id", "n" DESC, "position"
), "winners" AS (
  SELECT DISTINCT ON ("space_id", "group_key") "group_id", "group_key"
  FROM "chosen"
  ORDER BY "space_id", "group_key", "n" DESC, "created_at", "group_id"
)
UPDATE "category_groups" AS g
SET "key" = w."group_key"
FROM "winners" AS w
WHERE g."id" = w."group_id";--> statement-breakpoint
-- 2. A group still without a key takes the catalog group whose es or en name equals its name exactly, while that key
--    is free in its space (the oldest group on a tie).
UPDATE "category_groups" AS g
SET "key" = w."group_key"
FROM (
  SELECT DISTINCT ON (u."space_id", d."group_key") u."id", d."group_key"
  FROM "category_groups" AS u
  JOIN (VALUES
    ('housing', 'Vivienda', 'Housing'), ('food', 'Alimentación', 'Food'), ('transport', 'Transporte', 'Transport'),
    ('health', 'Salud', 'Health'), ('leisure', 'Ocio', 'Leisure'), ('income', 'Ingresos', 'Income')
  ) AS d ("group_key", "es", "en") ON u."name" IN (d."es", d."en")
  WHERE u."key" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "category_groups" AS k WHERE k."space_id" = u."space_id" AND k."key" = d."group_key"
    )
  ORDER BY u."space_id", d."group_key", u."created_at", u."id"
) AS w
WHERE g."id" = w."id";--> statement-breakpoint
-- 3. A keyed group takes the style of its catalog group; the other groups keep the column defaults (tag, GRAPHITE).
UPDATE "category_groups" AS g
SET "icon_kind" = 'SYMBOL', "icon_value" = d."icon", "color" = d."color"
FROM (VALUES
  ('housing', 'home', 'INDIGO'), ('food', 'apple', 'SAND'), ('transport', 'car', 'STEEL'),
  ('health', 'heart', 'ROSE'), ('leisure', 'ticket', 'PLUM'), ('income', 'coins', 'PINE')
) AS d ("group_key", "icon", "color")
WHERE g."key" = d."group_key";--> statement-breakpoint
-- 4. A seeded category takes its catalog style by key, in whatever group it is now; any other category takes its
--    group's. Subcategories keep no style.
UPDATE "categories" AS c
SET "icon_kind" = 'SYMBOL', "icon_value" = d."icon", "color" = d."color"
FROM (VALUES
  ('rent', 'key', 'INDIGO'), ('utilities', 'bulb', 'INDIGO'), ('maintenance', 'wrench', 'INDIGO'),
  ('groceries', 'cart', 'SAND'), ('restaurants', 'fork', 'SAND'),
  ('fuel', 'fuel', 'STEEL'), ('public_transport', 'bus', 'STEEL'),
  ('medical', 'cross', 'ROSE'), ('pharmacy', 'pill', 'ROSE'),
  ('entertainment', 'tv', 'PLUM'), ('travel', 'plane', 'PLUM'),
  ('salary', 'briefcase', 'PINE'), ('other_income', 'gift', 'PINE')
) AS d ("category_key", "icon", "color")
WHERE c."key" = d."category_key" AND c."parent_category_id" IS NULL;--> statement-breakpoint
UPDATE "categories" AS c
SET "icon_kind" = g."icon_kind", "icon_value" = g."icon_value", "color" = g."color"
FROM "category_groups" AS g
WHERE g."id" = c."group_id" AND c."icon_kind" IS NULL AND c."parent_category_id" IS NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_style_whole" CHECK (num_nulls("categories"."icon_kind", "categories"."icon_value", "categories"."color") IN (0, 3));--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_style_by_level" CHECK (("categories"."parent_category_id" IS NULL) = ("categories"."color" IS NOT NULL));