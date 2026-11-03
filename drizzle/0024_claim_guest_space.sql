-- #249, M2C-D3: the guest a CLAIM link hands over is a member of the link's space. The single-column key on
-- guest_member_id becomes a composite one on (guest_member_id, space_id), still ON DELETE CASCADE, which points at the
-- new unique key (id, space_id) of space_members; a link without a guest still passes (MATCH SIMPLE). Forward-only:
-- no row is rewritten or deleted. The block below reads the existing links first and stops the migration, naming
-- them, if any names a guest of another space. drizzle-kit generated the statements after it; they are reordered by
-- hand so the unique key exists before the foreign key that needs it.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(bad."id"::text, ', ') INTO found
  FROM (SELECT i."id" FROM "space_invitations" i JOIN "space_members" m ON m."id" = i."guest_member_id"
        WHERE m."space_id" <> i."space_id" ORDER BY i."id" LIMIT 20) AS bad;
  IF found IS NOT NULL THEN
    RAISE EXCEPTION '0024_claim_guest_space: claim links whose guest belongs to another space: %. Nothing was changed; correct these rows first (#249).', found;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_id_space_uq" UNIQUE("id","space_id");--> statement-breakpoint
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_guest_space_fk" FOREIGN KEY ("guest_member_id","space_id") REFERENCES "public"."space_members"("id","space_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_invitations" DROP CONSTRAINT "space_invitations_guest_member_id_space_members_id_fk";
