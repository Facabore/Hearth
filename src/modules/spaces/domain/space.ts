import {
  DEFAULT_PERIOD_POLICY,
  domainError,
  err,
  ok,
  type Id,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";

export type SpaceId = Id<"Space">;
export type SpaceMemberId = Id<"SpaceMember">;
export type SpaceKind = "PERSONAL" | "SHARED" | "DIRECT";
export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export interface SpaceMember {
  readonly id: SpaceMemberId;
  readonly kind: "USER" | "GUEST";
  readonly userId: string | null;
  readonly displayName: string;
  readonly role: SpaceRole | null;
  readonly joinedAt: Date;
}

export interface Space {
  readonly id: SpaceId;
  readonly name: string;
  readonly kind: SpaceKind;
  readonly currency: string;
  readonly periodPolicy: PeriodPolicy;
  readonly personalOwnerUserId: string | null;
  readonly members: readonly SpaceMember[];
  readonly createdAt: Date;
}

/** Spec 5.2: every user gets one personal space in COP with the default period policy. */
export const createPersonalSpace = (input: {
  id: SpaceId;
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  now: Date;
}): Space => ({
  id: input.id,
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: DEFAULT_PERIOD_POLICY,
  personalOwnerUserId: input.ownerUserId,
  members: [
    {
      id: input.memberId,
      kind: "USER",
      userId: input.ownerUserId,
      displayName: input.ownerName,
      role: "OWNER",
      joinedAt: input.now,
    },
  ],
  createdAt: input.now,
});

/** Personal spaces have exactly one member (spec 5.2, HU-E1-02). */
export const ensureCanAddMember = (space: Space): Result<void> =>
  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotShareable")) : ok(undefined);
