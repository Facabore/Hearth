-- P343: every person always has an @usuario. Writers wait while the rows without one get one, so no new row slips in
-- between the backfill and NOT NULL.
LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
-- The handle sign-up gives (handleCandidate in src/modules/identity/domain/handle.ts): the name with its accents
-- dropped, kept to a-z and 0-9 in lower case, cut to 10 characters ("hearth" when fewer than 3 remain), then "_" and 4
-- random digits; a taken one (ignoring case) is drawn again. Only rows without a handle change, so it can run again.
DO $$
DECLARE
  person record;
  stem text;
  candidate text;
  tries int;
BEGIN
  FOR person IN SELECT id, name FROM "user" WHERE handle IS NULL ORDER BY created_at, id LOOP
    stem := left(
      regexp_replace(
        lower(translate(person.name,
          'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç',
          'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc')),
        '[^a-z0-9]', '', 'g'),
      10);
    IF length(stem) < 3 THEN
      stem := 'hearth';
    END IF;
    tries := 0;
    LOOP
      tries := tries + 1;
      candidate := stem || '_' || lpad((floor(random() * 10000))::int::text, 4, '0');
      -- After 100 taken draws, the column default's form, so the loop always ends.
      IF tries > 100 THEN
        candidate := 'u_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      END IF;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "user" WHERE lower(handle) = candidate);
    END LOOP;
    UPDATE "user" SET handle = candidate WHERE id = person.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "handle" SET DEFAULT 'u_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "handle" SET NOT NULL;
