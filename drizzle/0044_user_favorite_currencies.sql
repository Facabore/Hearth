-- P342: a person's favorite ISO 4217 currencies, in their order; null until they choose some.
ALTER TABLE "user" ADD COLUMN "favorite_currencies" text[];
