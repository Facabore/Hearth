-- P347 (issue #352, owner: "los grupos deberían poderse borrar", "Sí, eliminar igual"): a category group is deleted
-- logically (D8). category_groups.deleted_at is new and null on every existing row, so nothing changes for the groups
-- stored today. A deleted group leaves the order and frees its name: the place and the name stay unique among the
-- groups not deleted only. Nothing is deleted or rewritten.
ALTER TABLE "category_groups" DROP CONSTRAINT "category_groups_space_position_uq";--> statement-breakpoint
DROP INDEX "category_groups_space_name_uq";--> statement-breakpoint
ALTER TABLE "category_groups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "category_groups_space_position_uq" ON "category_groups" USING btree ("space_id","position") WHERE "category_groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_groups_space_name_uq" ON "category_groups" USING btree ("space_id",lower("name")) WHERE "category_groups"."deleted_at" IS NULL;