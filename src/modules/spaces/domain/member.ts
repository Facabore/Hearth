import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SpaceMember, SpaceMemberId, SpaceRole } from "./space";

/** Same bound as a user's name at sign-up. */
const MAX_MEMBER_NAME = 100;

/** Emails are trimmed and lower-cased (as HU-E1-01 does for users), so binding and matching ignore case. */
export const normalizedEmail = (raw: string): string => raw.trim().toLowerCase();

/** HU-E1-10: display names are trimmed and 1–100 characters long. */
export const memberName = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_MEMBER_NAME
    ? ok(name)
    : err(domainError("InvalidMemberName", { length: name.length }));
};

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** HU-E1-10: a display name is unique among the current members of both kinds, ignoring case. */
export const ensureNameAvailable = (current: readonly SpaceMember[], name: string): Result<void> =>
  current.some((m) => sameName(m.displayName, name)) ? err(domainError("MemberNameTaken")) : ok(undefined);

/** Spec 5.2, D15: a guest has no user and no role; only guests carry a (lower-cased) contact email. */
export const guestMember = (input: {
  id: SpaceMemberId;
  displayName: string;
  contactEmail: string | null;
  now: Date;
  current: readonly SpaceMember[];
}): Result<SpaceMember> => {
  const name = memberName(input.displayName);
  if (!name.ok) return name;
  const available = ensureNameAvailable(input.current, name.value);
  if (!available.ok) return available;
  const contactEmail = input.contactEmail === null ? "" : normalizedEmail(input.contactEmail);
  const guest: SpaceMember = {
    id: input.id,
    kind: "GUEST",
    userId: null,
    displayName: name.value,
    role: null,
    contactEmail: contactEmail === "" ? null : contactEmail,
    joinedAt: input.now,
  };
  return ok(guest);
};

/**
 * The user's account name, or the first free "Name 2", "Name 3", … when a current member (or a name in
 * `alsoTaken`, e.g. one the database refused) uses it; never longer than 100 characters, suffix included.
 */
export const availableDisplayName = (
  current: readonly SpaceMember[],
  userName: string,
  alsoTaken: readonly string[] = [],
): string => {
  const trimmed = userName.trim();
  const base = trimmed === "" ? "Member" : trimmed.slice(0, MAX_MEMBER_NAME);
  const taken = (name: string) =>
    current.some((m) => sameName(m.displayName, name)) || alsoTaken.some((t) => sameName(t, name));
  if (!taken(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` ${suffix}`;
    const candidate = `${base.slice(0, MAX_MEMBER_NAME - tail.length)}${tail}`;
    if (!taken(candidate)) return candidate;
  }
};

/** HU-E1-07: a registered user joining through an invitation, with the invited role. */
export const userMember = (input: {
  id: SpaceMemberId;
  userId: string;
  userName: string;
  role: SpaceRole;
  now: Date;
  current: readonly SpaceMember[];
  /** Names to avoid besides the current members' (names a concurrent join took, Task 8). */
  alsoTaken?: readonly string[];
}): SpaceMember => ({
  id: input.id,
  kind: "USER",
  userId: input.userId,
  displayName: availableDisplayName(input.current, input.userName, input.alsoTaken),
  role: input.role,
  contactEmail: null,
  joinedAt: input.now,
});

/** HU-E1-05: a registered member's new role; guests have no role (D15) and a space keeps one OWNER. */
export const changeMemberRole = (
  current: readonly SpaceMember[],
  memberId: string,
  role: SpaceRole,
): Result<SpaceMember> => {
  const target = current.find((m) => m.id === memberId);
  if (!target) return err(domainError("MemberNotFound"));
  if (target.kind === "GUEST") return err(domainError("GuestHasNoRole"));
  const owners = current.filter((m) => m.role === "OWNER").length;
  if (target.role === "OWNER" && role !== "OWNER" && owners === 1) {
    return err(domainError("LastOwnerRequired"));
  }
  return ok({ ...target, role });
};
