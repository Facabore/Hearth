CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"owner_user_id" text,
	"opening_balance" bigint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "accounts_shared_fund_owner" CHECK (("accounts"."type" = 'SHARED_FUND') = ("accounts"."owner_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_space_name_uq" ON "accounts" USING btree ("space_id",lower("name"));