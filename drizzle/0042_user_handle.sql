ALTER TABLE "user" ADD COLUMN "handle" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_handle_uq" ON "user" USING btree (lower("handle"));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_handle_format" CHECK ("user"."handle" ~ '^[a-z0-9_]{3,20}$');