CREATE TABLE "space_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "space_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "space_invitations_email_kind" CHECK (("space_invitations"."kind" = 'EMAIL') = ("space_invitations"."email" IS NOT NULL)),
	CONSTRAINT "space_invitations_role" CHECK ("space_invitations"."role" IN ('ADMIN', 'MEMBER', 'VIEWER'))
);
--> statement-breakpoint
ALTER TABLE "space_members" DROP CONSTRAINT "space_members_space_user";--> statement-breakpoint
ALTER TABLE "space_members" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_invitations_space_id_idx" ON "space_invitations" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "space_invitations_created_by_idx" ON "space_invitations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "space_invitations_accepted_by_user_id_idx" ON "space_invitations" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_members_current_user_uq" ON "space_members" USING btree ("space_id","user_id") WHERE "space_members"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "space_members_current_name_uq" ON "space_members" USING btree ("space_id",lower("display_name")) WHERE "space_members"."left_at" IS NULL;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_guest_user" CHECK (("space_members"."kind" = 'GUEST') = ("space_members"."user_id" IS NULL));--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_guest_role" CHECK (("space_members"."kind" = 'GUEST') = ("space_members"."role" IS NULL));--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_contact_email" CHECK ("space_members"."contact_email" IS NULL OR "space_members"."kind" = 'GUEST');