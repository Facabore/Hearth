import {
  currencyOf,
  DEFAULT_PERIOD_POLICY,
  domainError,
  err,
  monthly,
  ok,
  semiMonthly,
  type Id,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";

export type SpaceId = Id<"Space">;
export type SpaceMemberId = Id<"SpaceMember">;
export type SpaceKind = "PERSONAL" | "SHARED" | "DIRECT";
export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** Spec 5.2, D15: kind GUEST <=> no user <=> no role; only guests carry a contact email. */
export interface SpaceMember {
  readonly id: SpaceMemberId;
  readonly kind: "USER" | "GUEST";
  readonly userId: string | null;
  readonly displayName: string;
  readonly role: SpaceRole | null;
  readonly contactEmail: string | null;
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

/** The creator of a space joins it as its OWNER. */
const founder = (input: {
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  now: Date;
}): SpaceMember => ({
  id: input.memberId,
  kind: "USER",
  userId: input.ownerUserId,
  displayName: input.ownerName,
  role: "OWNER",
  contactEmail: null,
  joinedAt: input.now,
});

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
  members: [founder(input)],
  createdAt: input.now,
});

/** HU-E1-04: a shared space starts with its creator as the only OWNER, MONTHLY(1) and a supported currency. */
export const createSharedSpace = (input: {
  id: SpaceId;
  memberId: SpaceMemberId;
  ownerUserId: string;
  ownerName: string;
  name: string;
  currency: string;
  now: Date;
}): Result<Space> => {
  const name = spaceName(input.name);
  if (!name.ok) return name;
  const currency = currencyOf(input.currency);
  if (!currency.ok) return currency;
  const space: Space = {
    id: input.id,
    name: name.value,
    kind: "SHARED",
    currency: currency.value.code,
    periodPolicy: DEFAULT_PERIOD_POLICY,
    personalOwnerUserId: null,
    members: [founder(input)],
    createdAt: input.now,
  };
  return ok(space);
};

/** Personal spaces have exactly one member (spec 5.2, HU-E1-02); guests never join them either (HU-E1-10). */
export const ensureCanAddMember = (space: Pick<Space, "kind">): Result<void> =>
  space.kind === "PERSONAL" ? err(domainError("PersonalSpaceNotShareable")) : ok(undefined);

const MAX_SPACE_NAME = 80;

/** HU-E1-03: space names are trimmed and 1–80 characters long. */
export const spaceName = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_SPACE_NAME
    ? ok(name)
    : err(domainError("InvalidSpaceName", { length: name.length }));
};

/** Re-checks a policy that arrived from outside: the wire format accepts any integer days. */
export const checkedPeriodPolicy = (policy: PeriodPolicy): Result<PeriodPolicy> =>
  policy.kind === "MONTHLY" ? monthly(policy.day) : semiMonthly(policy.day1, policy.day2);
