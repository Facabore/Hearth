DROP INDEX "categories_group_name_uq";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_group_name_uq" ON "categories" USING btree ("group_id",lower("name")) WHERE "categories"."deleted_at" IS NULL;