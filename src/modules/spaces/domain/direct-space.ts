import { currencyOf, DEFAULT_PERIOD_POLICY, ok, type Result } from "@/shared/kernel";
import { guestMember, userMember } from "./member";
import {
  DIRECT_MEMBER_ROLE,
  founder,
  MAX_SPACE_NAME,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "./space";

/** HU-E1-13: whom a direct space is shared with: a registered user (an OWNER too, D16) or a new guest. */
export type DirectCounterpart =
  | { readonly kind: "USER"; readonly userId: string; readonly displayName: string }
  | { readonly kind: "GUEST"; readonly displayName: string; readonly contactEmail: string | null };

/** HU-E1-13: one active DIRECT space per unordered pair of registered users, keyed the same either way. */
export const pairKeyOf = (userA: string, userB: string): string => [userA, userB].sort().join(":");

/** The pair key a DIRECT space is stored under; null unless both of its members are registered users. */
export const directPairKey = (space: Pick<Space, "kind" | "members">): string | null => {
  if (space.kind !== "DIRECT" || space.members.length !== 2) return null;
  const [a, b] = space.members.map((m) => m.userId);
  return a && b ? pairKeyOf(a, b) : null;
};

/** "Ana & Pedro", cut to the length limit of space names. */
const directSpaceName = (a: string, b: string): string => `${a} & ${b}`.slice(0, MAX_SPACE_NAME).trimEnd();

const counterpartMember = (
  creator: SpaceMember,
  input: { counterpartMemberId: SpaceMemberId; counterpart: DirectCounterpart; now: Date },
): Result<SpaceMember> => {
  const { counterpart } = input;
  if (counterpart.kind === "GUEST") {
    return guestMember({
      id: input.counterpartMemberId,
      displayName: counterpart.displayName,
      contactEmail: counterpart.contactEmail,
      now: input.now,
      current: [creator],
    });
  }
  return ok(
    userMember({
      id: input.counterpartMemberId,
      userId: counterpart.userId,
      userName: counterpart.displayName,
      role: DIRECT_MEMBER_ROLE,
      now: input.now,
      current: [creator],
    }),
  );
};

/**
 * HU-E1-13, D16: a DIRECT space between its creator and one other person, named after both, with the
 * default period policy and no plan. Both registered members are OWNER; a guest has no role.
 */
export const createDirectSpace = (input: {
  id: SpaceId;
  creatorMemberId: SpaceMemberId;
  counterpartMemberId: SpaceMemberId;
  creatorUserId: string;
  creatorName: string;
  counterpart: DirectCounterpart;
  currency: string;
  now: Date;
}): Result<Space> => {
  const currency = currencyOf(input.currency);
  if (!currency.ok) return currency;
  const creator = founder({
    memberId: input.creatorMemberId,
    ownerUserId: input.creatorUserId,
    ownerName: input.creatorName,
    now: input.now,
  });
  const other = counterpartMember(creator, input);
  if (!other.ok) return other;
  const space: Space = {
    id: input.id,
    name: directSpaceName(creator.displayName, other.value.displayName),
    kind: "DIRECT",
    currency: currency.value.code,
    periodPolicy: DEFAULT_PERIOD_POLICY,
    personalOwnerUserId: null,
    members: [creator, other.value],
    createdAt: input.now,
  };
  return ok(space);
};
