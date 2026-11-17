import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SpaceMember, SpaceMemberId } from "./space";

/** Ruling P338: an apodo is trimmed and 1–40 characters long. */
export const MAX_NICKNAME = 40;

/** Ruling P338: a trimmed apodo of 1–40 characters, or null, which clears it. */
export const friendNickname = (raw: string | null): Result<string | null> => {
  if (raw === null) return ok(null);
  const nickname = raw.trim();
  return nickname.length >= 1 && nickname.length <= MAX_NICKNAME
    ? ok(nickname)
    : err(domainError("InvalidNickname", { length: nickname.length }));
};

/** Ruling P338: a guest's apodo is its name, and a guest always has one, so null is refused. */
export const guestNickname = (raw: string | null): Result<string> => {
  const nickname = friendNickname(raw);
  if (!nickname.ok) return nickname;
  return nickname.value === null ? err(domainError("InvalidNickname", { length: 0 })) : ok(nickname.value);
};

/** Ruling P338: the other member of a direct space as its viewer sees them. */
export interface FriendName {
  readonly other: {
    readonly memberId: SpaceMemberId;
    readonly kind: SpaceMember["kind"];
    readonly displayName: string;
    /** The viewer's own apodo for a registered person; always null for a guest, whose apodo is its name. */
    readonly nickname: string | null;
  };
  /** What the viewer calls them: the apodo, else the name the space knows them by. */
  readonly name: string;
}

/** Ruling P338: the viewer's alias names a registered person only; a guest is called by its name. */
export const friendName = (other: SpaceMember, viewerAlias: string | null): FriendName => {
  const nickname = other.kind === "USER" ? viewerAlias : null;
  return {
    other: { memberId: other.id, kind: other.kind, displayName: other.displayName, nickname },
    name: nickname ?? other.displayName,
  };
};

/** D16: the one current member of a direct space who is not the viewer; undefined when there is none. */
export const directPeer = (
  current: readonly SpaceMember[],
  viewerMemberId: string,
): SpaceMember | undefined => current.find((member) => member.id !== viewerMemberId);
