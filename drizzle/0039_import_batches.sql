-- D28, design §3.2-3.5 (issue #326): the Money Manager import's batches and links. Forward-only and additive: two new
-- tables, no existing row touched. A batch keeps the upload's hash and neutral snapshot, never the file; the snapshot
-- is set to null 7 days after the batch is settled. A link ties a source row to what it became, unique per source key.
-- Numbered 0039 while MC4 takes 0038 in parallel; the journal entry is idx 38 until the two are merged.
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source_app" text NOT NULL,
	"file_sha256" text NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb,
	"mappings" jsonb NOT NULL,
	"counts" jsonb,
	"row_errors" jsonb NOT NULL,
	"created" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_links" (
	"space_id" uuid NOT NULL,
	"source_app" text NOT NULL,
	"source_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	CONSTRAINT "import_links_source_uq" UNIQUE("space_id","source_app","source_key","entity_type")
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_links" ADD CONSTRAINT "import_links_import_id_import_batches_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_space_created_idx" ON "import_batches" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batches_space_hash_idx" ON "import_batches" USING btree ("space_id","file_sha256");--> statement-breakpoint
CREATE INDEX "import_links_import_idx" ON "import_links" USING btree ("import_id");