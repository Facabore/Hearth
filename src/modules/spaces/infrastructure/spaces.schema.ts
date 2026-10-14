import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import type { PeriodPolicy } from "@/shared/kernel";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["PERSONAL", "SHARED", "DIRECT"] }).notNull(),
    currency: text("currency").notNull(),
    periodPolicy: jsonb("period_policy").$type<PeriodPolicy>().notNull(),
    personalOwnerUserId: text("personal_owner_user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // HU-E1-13: "<userA>:<userB>" (sorted) for a DIRECT space created between two registered users.
    directPairKey: text("direct_pair_key"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("spaces_personal_owner", sql`(${t.kind} = 'PERSONAL') = (${t.personalOwnerUserId} IS NOT NULL)`),
    // D16: one active direct space per pair of users; an archived one keeps its key and frees the pair.
    uniqueIndex("spaces_direct_pair_uq")
      .on(t.directPairKey)
      .where(sql`${t.archivedAt} IS NULL`),
    check("spaces_direct_pair_kind", sql`${t.directPairKey} IS NULL OR ${t.kind} = 'DIRECT'`),
  ],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["USER", "GUEST"] }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] }),
    contactEmail: text("contact_email"),
    joinedAt: tz("joined_at").notNull(),
    leftAt: tz("left_at"),
    claimedAt: tz("claimed_at"),
  },
  (t) => [
    // HU-E1-07: one row per user among current members; a former member who joins again gets a new row.
    uniqueIndex("space_members_current_user_uq")
      .on(t.spaceId, t.userId)
      .where(sql`${t.leftAt} IS NULL`),
    // HU-E1-10: display names are unique among current members of both kinds, ignoring case.
    uniqueIndex("space_members_current_name_uq")
      .on(t.spaceId, sql`lower(${t.displayName})`)
      .where(sql`${t.leftAt} IS NULL`),
    index("space_members_user_id_idx").on(t.userId),
    // Spec 5.2, D15: GUEST <=> no user <=> no role; only guests carry a contact email.
    check("space_members_guest_user", sql`(${t.kind} = 'GUEST') = (${t.userId} IS NULL)`),
    check("space_members_guest_role", sql`(${t.kind} = 'GUEST') = (${t.role} IS NULL)`),
    check("space_members_contact_email", sql`${t.contactEmail} IS NULL OR ${t.kind} = 'GUEST'`),
  ],
);

// HU-E1-06, HU-E1-07, HU-E1-11. Values mirror the domain types; listed here so drizzle-kit loads no domain code.
export const spaceInvitations = pgTable(
  "space_invitations",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["EMAIL", "LINK", "CLAIM"] }).notNull(),
    email: text("email"),
    role: text("role", { enum: ["ADMIN", "MEMBER", "VIEWER"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: ["PENDING", "ACCEPTED", "REVOKED"] }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull(),
    expiresAt: tz("expires_at").notNull(),
    acceptedAt: tz("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    revokedAt: tz("revoked_at"),
    // HU-E1-11: the guest whose place a CLAIM link hands over.
    guestMemberId: uuid("guest_member_id").references(() => spaceMembers.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("space_invitations_space_id_idx").on(t.spaceId),
    // Foreign keys to user: deleting a user finds its invitations without a scan.
    index("space_invitations_created_by_idx").on(t.createdBy),
    index("space_invitations_accepted_by_user_id_idx").on(t.acceptedByUserId),
    // HU-E1-12: a guest's pending claim links are revoked when the guest is removed.
    index("space_invitations_guest_member_id_idx").on(t.guestMemberId),
    // Email invitations are bound to one address; link invitations to none.
    check("space_invitations_email_kind", sql`(${t.kind} = 'EMAIL') = (${t.email} IS NOT NULL)`),
    // An invitation never grants OWNER.
    check("space_invitations_role", sql`${t.role} IN ('ADMIN', 'MEMBER', 'VIEWER')`),
    // HU-E1-11: claim links, and only they, name a guest; they are stored as MEMBER.
    check("space_invitations_claim_guest", sql`(${t.kind} = 'CLAIM') = (${t.guestMemberId} IS NOT NULL)`),
    check("space_invitations_claim_role", sql`${t.kind} <> 'CLAIM' OR ${t.role} = 'MEMBER'`),
  ],
);
