CREATE TABLE "recurrence_occurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recurrence_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"transaction_id" uuid,
	"reason" text,
	"resolved_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "recurrence_occurrences_amount_positive" CHECK ("recurrence_occurrences"."amount" > 0),
	CONSTRAINT "recurrence_occurrences_recorded" CHECK (("recurrence_occurrences"."status" = 'RECORDED') = ("recurrence_occurrences"."transaction_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "recurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"category_id" uuid,
	"payer_member_id" uuid,
	"source_account_id" uuid,
	"destination_account_id" uuid,
	"split" jsonb,
	"schedule" jsonb NOT NULL,
	"mode" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"due_from" date NOT NULL,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recurrences_amount_positive" CHECK ("recurrences"."amount" > 0),
	CONSTRAINT "recurrences_dates" CHECK ("recurrences"."end_date" IS NULL OR "recurrences"."end_date" >= "recurrences"."start_date"),
	CONSTRAINT "recurrences_shape" CHECK (("recurrences"."type" = 'EXPENSE' AND "recurrences"."category_id" IS NOT NULL AND "recurrences"."destination_account_id" IS NULL AND ("recurrences"."payer_member_id" IS NOT NULL OR "recurrences"."source_account_id" IS NOT NULL))
        OR ("recurrences"."type" = 'INCOME' AND "recurrences"."category_id" IS NOT NULL AND "recurrences"."payer_member_id" IS NULL AND "recurrences"."source_account_id" IS NULL AND "recurrences"."destination_account_id" IS NOT NULL AND "recurrences"."split" IS NULL)
        OR ("recurrences"."type" = 'TRANSFER' AND "recurrences"."category_id" IS NULL AND "recurrences"."payer_member_id" IS NULL AND "recurrences"."source_account_id" IS NOT NULL AND "recurrences"."destination_account_id" IS NOT NULL AND "recurrences"."split" IS NULL)
        OR ("recurrences"."type" = 'FUND_CONTRIBUTION' AND "recurrences"."category_id" IS NULL AND "recurrences"."payer_member_id" IS NOT NULL AND "recurrences"."destination_account_id" IS NOT NULL AND "recurrences"."split" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_recurrence_id_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."recurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_payer_member_id_space_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_occurrences_date_uq" ON "recurrence_occurrences" USING btree ("recurrence_id","occurrence_date");--> statement-breakpoint
CREATE UNIQUE INDEX "recurrence_occurrences_transaction_uq" ON "recurrence_occurrences" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "recurrence_occurrences_pending_idx" ON "recurrence_occurrences" USING btree ("space_id","occurrence_date") WHERE "recurrence_occurrences"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "recurrences_space_idx" ON "recurrences" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "recurrences_active_idx" ON "recurrences" USING btree ("due_from") WHERE "recurrences"."paused_at" IS NULL AND "recurrences"."ended_at" IS NULL;