-- Ruling P330 back-fill, written by hand: every live space with a seeded tree gets, once, what the fuller default
-- catalog added, by catalog key (spec D11), named in the language its seeded names already use. Nothing existing is
-- renamed, moved or restyled, and running it again adds nothing.
-- 1. The catalog, as DEFAULT_CATALOG lists it (src/modules/categories/domain/default-catalog.ts; a test keeps them equal).
CREATE TEMPORARY TABLE "p330_groups" (
  "key" text PRIMARY KEY,
  "es" text NOT NULL,
  "en" text NOT NULL,
  "icon" text NOT NULL,
  "color" text NOT NULL,
  "position" integer NOT NULL
);--> statement-breakpoint
INSERT INTO "p330_groups" ("key", "es", "en", "icon", "color", "position") VALUES
  ('housing', 'Vivienda', 'Housing', 'home', 'INDIGO', 0),
  ('food', 'Alimentación', 'Food', 'apple', 'SAND', 1),
  ('transport', 'Transporte', 'Transport', 'car', 'STEEL', 2),
  ('subscriptions', 'Suscripciones', 'Subscriptions', 'tv', 'TEAL', 3),
  ('health', 'Salud', 'Health', 'heart', 'ROSE', 4),
  ('personal_care', 'Cuidado personal', 'Personal care', 'scissors', 'CORAL', 5),
  ('education', 'Educación', 'Education', 'graduation', 'SKY', 6),
  ('pets', 'Mascotas', 'Pets', 'paw', 'AMBER', 7),
  ('leisure', 'Ocio', 'Leisure', 'ticket', 'PLUM', 8),
  ('gifts', 'Regalos y donaciones', 'Gifts and donations', 'gift', 'LAVENDER', 9),
  ('finance', 'Finanzas', 'Finance', 'bank', 'GRAPHITE', 10),
  ('other', 'Otros', 'Other', 'dots', 'OLIVE', 11),
  ('income', 'Ingresos', 'Income', 'coins', 'PINE', 12);--> statement-breakpoint
CREATE TEMPORARY TABLE "p330_categories" (
  "key" text PRIMARY KEY,
  "group_key" text NOT NULL,
  "es" text NOT NULL,
  "en" text NOT NULL,
  "icon" text NOT NULL
);--> statement-breakpoint
INSERT INTO "p330_categories" ("key", "group_key", "es", "en", "icon") VALUES
  ('rent', 'housing', 'Arriendo', 'Rent', 'key'),
  ('utilities', 'housing', 'Servicios', 'Utilities', 'bulb'),
  ('maintenance', 'housing', 'Mantenimiento', 'Maintenance', 'wrench'),
  ('home_goods', 'housing', 'Hogar y muebles', 'Home and furniture', 'sofa'),
  ('groceries', 'food', 'Mercado', 'Groceries', 'cart'),
  ('restaurants', 'food', 'Restaurantes', 'Restaurants', 'fork'),
  ('delivery', 'food', 'Domicilios', 'Delivery', 'bag'),
  ('snacks', 'food', 'Café y snacks', 'Coffee and snacks', 'cup'),
  ('fuel', 'transport', 'Combustible', 'Fuel', 'fuel'),
  ('public_transport', 'transport', 'Transporte público', 'Public transport', 'bus'),
  ('ride_hailing', 'transport', 'Taxi y apps', 'Taxis and ride apps', 'car'),
  ('parking', 'transport', 'Parqueadero y peajes', 'Parking and tolls', 'parking'),
  ('vehicle_maintenance', 'transport', 'Mantenimiento del vehículo', 'Vehicle maintenance', 'wrench'),
  ('streaming', 'subscriptions', 'Streaming', 'Streaming', 'tv'),
  ('music', 'subscriptions', 'Música', 'Music', 'music'),
  ('software', 'subscriptions', 'Apps y software', 'Apps and software', 'laptop'),
  ('mobile_plan', 'subscriptions', 'Plan de celular', 'Phone plan', 'phone'),
  ('medical', 'health', 'Médico', 'Medical', 'cross'),
  ('pharmacy', 'health', 'Farmacia', 'Pharmacy', 'pill'),
  ('fitness', 'health', 'Gimnasio y deporte', 'Gym and sports', 'gym'),
  ('dental', 'health', 'Odontología', 'Dental care', 'tooth'),
  ('beauty', 'personal_care', 'Peluquería y belleza', 'Hair and beauty', 'scissors'),
  ('clothing', 'personal_care', 'Ropa y calzado', 'Clothes and shoes', 'shirt'),
  ('tuition', 'education', 'Cursos y matrículas', 'Courses and tuition', 'graduation'),
  ('books', 'education', 'Libros y útiles', 'Books and supplies', 'book'),
  ('pet_care', 'pets', 'Comida y cuidado', 'Food and care', 'paw'),
  ('vet', 'pets', 'Veterinario', 'Vet', 'cross'),
  ('entertainment', 'leisure', 'Entretenimiento', 'Entertainment', 'tv'),
  ('travel', 'leisure', 'Viajes', 'Travel', 'plane'),
  ('going_out', 'leisure', 'Salidas y bares', 'Going out', 'wine'),
  ('games', 'leisure', 'Juegos', 'Games', 'game'),
  ('gifts_given', 'gifts', 'Regalos', 'Gifts', 'gift'),
  ('donations', 'gifts', 'Donaciones', 'Donations', 'heart'),
  ('bank_fees', 'finance', 'Comisiones bancarias', 'Bank fees', 'bank'),
  ('interest', 'finance', 'Intereses', 'Interest', 'percent'),
  ('insurance', 'finance', 'Seguros', 'Insurance', 'shield'),
  ('taxes', 'finance', 'Impuestos', 'Taxes', 'receipt'),
  ('unexpected', 'other', 'Imprevistos', 'Unexpected expenses', 'umbrella'),
  ('salary', 'income', 'Salario', 'Salary', 'briefcase'),
  ('other_income', 'income', 'Otros ingresos', 'Other income', 'gift'),
  ('freelance', 'income', 'Freelance', 'Freelance', 'laptop'),
  ('investment_income', 'income', 'Rendimientos', 'Investment returns', 'chart');--> statement-breakpoint
-- 2. The spaces that take part, each with its language: a live space with at least one keyed group or category (a
--    seeded tree, archived and deleted rows included). Its language is the one more of its keyed rows still carry the
--    catalog name of, among the names that differ between es and en; Spanish on a tie or when none matches.
CREATE TEMPORARY TABLE "p330_spaces" AS
WITH "seeded" AS (
  SELECT g."space_id", CASE g."name" WHEN d."es" THEN 'es' WHEN d."en" THEN 'en' END AS "language"
  FROM "category_groups" AS g
  JOIN "p330_groups" AS d ON d."key" = g."key" AND d."es" <> d."en"
  UNION ALL
  SELECT c."space_id", CASE c."name" WHEN d."es" THEN 'es' WHEN d."en" THEN 'en' END
  FROM "categories" AS c
  JOIN "p330_categories" AS d ON d."key" = c."key" AND d."es" <> d."en"
  UNION ALL
  -- A keyed row the catalog no longer knows still marks the space as seeded, without a language.
  SELECT g."space_id", NULL FROM "category_groups" AS g WHERE g."key" IS NOT NULL
  UNION ALL
  SELECT c."space_id", NULL FROM "categories" AS c WHERE c."key" IS NOT NULL
)
SELECT
  s."id" AS "space_id",
  CASE
    WHEN count(*) FILTER (WHERE r."language" = 'en') > count(*) FILTER (WHERE r."language" = 'es') THEN 'en'
    ELSE 'es'
  END AS "language"
FROM "spaces" AS s
JOIN "seeded" AS r ON r."space_id" = s."id"
WHERE s."archived_at" IS NULL
GROUP BY s."id";--> statement-breakpoint
-- 3. A group the space never had (no row with its key, archived or not) goes after the space's groups, in catalog
--    order (ruling P296), unless a group of the space already has its name (names are unique ignoring case).
INSERT INTO "category_groups" ("id", "space_id", "name", "key", "icon_kind", "icon_value", "color", "position", "created_at")
SELECT
  gen_random_uuid(),
  n."space_id",
  n."name",
  n."key",
  'SYMBOL',
  n."icon",
  n."color",
  (SELECT coalesce(max(g."position"), -1) FROM "category_groups" AS g WHERE g."space_id" = n."space_id")
    + row_number() OVER (PARTITION BY n."space_id" ORDER BY n."position"),
  now()
FROM (
  SELECT
    s."space_id",
    CASE s."language" WHEN 'en' THEN d."en" ELSE d."es" END AS "name",
    d."key",
    d."icon",
    d."color",
    d."position"
  FROM "p330_spaces" AS s
  CROSS JOIN "p330_groups" AS d
) AS n
WHERE NOT EXISTS (
    SELECT 1 FROM "category_groups" AS g WHERE g."space_id" = n."space_id" AND g."key" = n."key"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "category_groups" AS g WHERE g."space_id" = n."space_id" AND lower(g."name") = lower(n."name")
  );--> statement-breakpoint
-- 4. A category the space never had (no row with its key, in any state) goes into the live group with its catalog
--    group's key, wherever that group is now and whatever it is called, unless a category of that group already has
--    its name (HU-E3-02). Like a seeded one, it takes its group's color (HU-E3-05).
INSERT INTO "categories" ("id", "space_id", "group_id", "parent_category_id", "name", "key", "icon_kind", "icon_value", "color", "created_at")
SELECT gen_random_uuid(), n."space_id", n."group_id", NULL, n."name", n."key", 'SYMBOL', n."icon", n."color", now()
FROM (
  SELECT
    s."space_id",
    g."id" AS "group_id",
    g."color",
    CASE s."language" WHEN 'en' THEN d."en" ELSE d."es" END AS "name",
    d."key",
    d."icon"
  FROM "p330_spaces" AS s
  JOIN "category_groups" AS g ON g."space_id" = s."space_id" AND g."archived_at" IS NULL
  JOIN "p330_categories" AS d ON d."group_key" = g."key"
) AS n
WHERE NOT EXISTS (
    SELECT 1 FROM "categories" AS c WHERE c."space_id" = n."space_id" AND c."key" = n."key"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "categories" AS c
    WHERE c."group_id" = n."group_id"
      AND c."parent_category_id" IS NULL
      AND c."deleted_at" IS NULL
      AND lower(c."name") = lower(n."name")
  );--> statement-breakpoint
DROP TABLE "p330_spaces", "p330_categories", "p330_groups";
