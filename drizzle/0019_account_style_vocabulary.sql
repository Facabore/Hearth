-- #125, ruling P122: accounts take the categories' palette keys and Hearth symbol names. Written by hand: no DDL, the
-- columns stay text (the contract refuses other values, ruling P50). Each UPDATE touches only rows holding an old
-- value, so a second run changes nothing; a value outside the old lists cannot be stored, and if one were it stays as
-- it is. A null color still means no color, and a null icon the type's default. Responses kept for idempotent replays
-- (idempotency_keys.response_body) are not rewritten: they expire with their keys.
UPDATE "accounts" SET "color" = CASE "color"
  WHEN 'pine' THEN 'PINE' WHEN 'ember' THEN 'EMBER' WHEN 'sand' THEN 'SAND' WHEN 'sky' THEN 'SKY'
  WHEN 'plum' THEN 'PLUM' WHEN 'moss' THEN 'SAGE' WHEN 'clay' THEN 'CORAL' WHEN 'slate' THEN 'STEEL'
  WHEN 'gold' THEN 'MUSTARD' WHEN 'rose' THEN 'ROSE' END
WHERE "color" IN ('pine', 'ember', 'sand', 'sky', 'plum', 'moss', 'clay', 'slate', 'gold', 'rose');--> statement-breakpoint
UPDATE "accounts" SET "icon" = CASE "icon"
  WHEN 'banknote' THEN 'cash' WHEN 'landmark' THEN 'bank' WHEN 'wallet' THEN 'wallet' WHEN 'credit-card' THEN 'card'
  WHEN 'piggy-bank' THEN 'piggy' WHEN 'trending-up' THEN 'trend' WHEN 'hand-coins' THEN 'coins'
  WHEN 'circle-ellipsis' THEN 'dots' WHEN 'users' THEN 'users' WHEN 'briefcase' THEN 'briefcase' WHEN 'car' THEN 'car'
  WHEN 'gem' THEN 'star' WHEN 'gift' THEN 'gift' WHEN 'house' THEN 'home' WHEN 'plane' THEN 'plane'
  WHEN 'smartphone' THEN 'phone' END
WHERE "icon" IN ('banknote', 'landmark', 'wallet', 'credit-card', 'piggy-bank', 'trending-up', 'hand-coins',
  'circle-ellipsis', 'users', 'briefcase', 'car', 'gem', 'gift', 'house', 'plane', 'smartphone');
