CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"pair_key" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "friend_requests_status" CHECK ("friend_requests"."status" IN ('PENDING', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "friend_requests_not_self" CHECK ("friend_requests"."from_user_id" <> "friend_requests"."to_user_id"),
	CONSTRAINT "friend_requests_decided" CHECK (("friend_requests"."status" = 'PENDING') = ("friend_requests"."decided_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_open_pair_uq" ON "friend_requests" USING btree ("pair_key") WHERE "friend_requests"."status" <> 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "friend_requests_from_user_id_idx" ON "friend_requests" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "friend_requests_to_user_id_idx" ON "friend_requests" USING btree ("to_user_id");