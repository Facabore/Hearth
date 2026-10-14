ALTER TABLE "space_invitations" ADD COLUMN "guest_member_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "direct_pair_key" text;--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_guest_member_id_space_members_id_fk" FOREIGN KEY ("guest_member_id") REFERENCES "public"."space_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_invitations_guest_member_id_idx" ON "space_invitations" USING btree ("guest_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_direct_pair_uq" ON "spaces" USING btree ("direct_pair_key") WHERE "spaces"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_claim_guest" CHECK (("space_invitations"."kind" = 'CLAIM') = ("space_invitations"."guest_member_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_claim_role" CHECK ("space_invitations"."kind" <> 'CLAIM' OR "space_invitations"."role" = 'MEMBER');--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_direct_pair_kind" CHECK ("spaces"."direct_pair_key" IS NULL OR "spaces"."kind" = 'DIRECT');