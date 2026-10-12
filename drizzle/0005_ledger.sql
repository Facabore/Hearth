CREATE TABLE "payments" (
	"transaction_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"member_id" uuid,
	"account_id" uuid,
	"amount" bigint NOT NULL,
	CONSTRAINT "payments_transaction_id_position_pk" PRIMARY KEY("transaction_id","position"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_has_payer" CHECK ("payments"."member_id" IS NOT NULL OR "payments"."account_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"transaction_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"split_method" text NOT NULL,
	CONSTRAINT "shares_transaction_id_position_pk" PRIMARY KEY("transaction_id","position"),
	CONSTRAINT "shares_amount_positive" CHECK ("shares"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"changes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"date" date NOT NULL,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"source_account_id" uuid,
	"destination_account_id" uuid,
	"receiving_member_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0),
	CONSTRAINT "transactions_shape" CHECK (("transactions"."type" = 'EXPENSE' AND "transactions"."category_id" IS NOT NULL AND "transactions"."source_account_id" IS NULL AND "transactions"."destination_account_id" IS NULL AND "transactions"."receiving_member_id" IS NULL)
        OR ("transactions"."type" = 'INCOME' AND "transactions"."category_id" IS NOT NULL AND "transactions"."source_account_id" IS NULL AND "transactions"."destination_account_id" IS NOT NULL AND "transactions"."receiving_member_id" IS NOT NULL)
        OR ("transactions"."type" = 'TRANSFER' AND "transactions"."category_id" IS NULL AND "transactions"."source_account_id" IS NOT NULL AND "transactions"."destination_account_id" IS NOT NULL AND "transactions"."receiving_member_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_space_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_member_id_space_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_audit" ADD CONSTRAINT "transaction_audit_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receiving_member_id_space_members_id_fk" FOREIGN KEY ("receiving_member_id") REFERENCES "public"."space_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_account_idx" ON "payments" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "payments_member_idx" ON "payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "shares_member_idx" ON "shares" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "transaction_audit_transaction_idx" ON "transaction_audit" USING btree ("transaction_id","at");--> statement-breakpoint
CREATE INDEX "transactions_space_date_idx" ON "transactions" USING btree ("space_id","date","id");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_source_account_idx" ON "transactions" USING btree ("source_account_id");--> statement-breakpoint
CREATE INDEX "transactions_destination_account_idx" ON "transactions" USING btree ("destination_account_id");