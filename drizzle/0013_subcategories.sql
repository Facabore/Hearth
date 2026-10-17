DROP INDEX "categories_group_name_uq";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_category_id_categories_id_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_parent_name_uq" ON "categories" USING btree (coalesce("parent_category_id", "group_id"),lower("name")) WHERE "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_category_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_category_id" <> "categories"."id");