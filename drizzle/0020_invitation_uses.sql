-- #218, ruling P264: who joined through an invitation, one row per person. Additive only: no existing row is
-- rewritten or deleted. Links used before this migration have no rows; an ADMIN link among them stays open until it
-- expires (7 days at most), as the ruling accepts.
CREATE TABLE "space_invitation_uses" (
	"invitation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_invitation_uses_invitation_id_user_id_pk" PRIMARY KEY("invitation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "space_invitation_uses" ADD CONSTRAINT "space_invitation_uses_invitation_id_space_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."space_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invitation_uses" ADD CONSTRAINT "space_invitation_uses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_invitation_uses_user_id_idx" ON "space_invitation_uses" USING btree ("user_id");