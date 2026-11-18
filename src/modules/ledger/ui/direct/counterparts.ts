import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";

/**
 * P334: a space the recorder and someone share, where a transfer between them is recorded: their direct space (with
 * no id while it does not exist: the API creates it on first use, D16) or a group they are both members of.
 */
export interface Place {
  readonly spaceId: string | null;
  readonly name: string | null;
  readonly kind: "DIRECT" | "SHARED";
  /** The space's currency, which the recorder's account must be in; null for a direct space not created yet. */
  readonly currency: string | null;
  /** Their member id and the recorder's in that space; null for a direct space not created yet. */
  readonly theirMemberId: string | null;
  readonly myMemberId: string | null;
}

/** HU-E1-13, ruling P172: someone to split one expense with. */
export interface Person {
  readonly memberId: string;
  readonly name: string;
  readonly isGuest: boolean;
  /** The name of the direct space the split will use, or null when the API creates one. */
  readonly directSpace: string | null;
  /** P334: where a transfer with them can be recorded, their direct space first. */
  readonly places: readonly Place[];
}

/**
 * #338: the other member of one of the recorder's direct spaces, as Amigos' one read answers it
 * (`GET /api/v1/me/friends`), so the form never reads each direct space's members.
 */
export interface DirectPeer {
  readonly spaceId: string;
  readonly me: { readonly memberId: string };
  readonly other: {
    readonly memberId: string;
    readonly kind: "USER" | "GUEST";
    readonly displayName: string;
    /** Absent for a guest. */
    readonly userId?: string;
  };
}

/**
 * The people the recorder shares a space with: the other member of each direct space (a guest included, D15: a guest
 * exists only in its own space), then each registered co-member of a shared space once, unless a direct space already
 * holds them. Shared spaces' guests are left out: the API refuses them (InvalidDirectCounterpart). The direct spaces'
 * people come from `friends`, the shared spaces' from `membersBySpace` (#338).
 */
export const peopleOf = (input: {
  readonly meUserId: string;
  readonly spaces: readonly SpaceDto[];
  readonly friends: readonly DirectPeer[];
  readonly membersBySpace: Readonly<Record<string, readonly MemberDto[]>>;
}): Person[] => {
  type Building = Omit<Person, "places"> & { places: Place[] };
  const people: Building[] = [];
  const byUser = new Map<string, Building>();
  const peerIn = new Map(input.friends.map((friend) => [friend.spaceId, friend]));
  const meIn = (spaceId: string) =>
    (input.membersBySpace[spaceId] ?? []).find((m) => m.userId === input.meUserId)?.id ?? null;
  for (const space of input.spaces.filter((s) => s.kind === "DIRECT")) {
    const peer = peerIn.get(space.id);
    if (!peer) continue;
    const { other } = peer;
    const person: Building = {
      memberId: other.memberId,
      name: other.displayName,
      isGuest: other.kind === "GUEST",
      directSpace: space.name,
      places: [
        {
          spaceId: space.id,
          name: space.name,
          kind: "DIRECT",
          currency: space.currency,
          theirMemberId: other.memberId,
          myMemberId: peer.me.memberId,
        },
      ],
    };
    if (other.userId) byUser.set(other.userId, person);
    people.push(person);
  }
  for (const space of input.spaces.filter((s) => s.kind === "SHARED"))
    for (const member of input.membersBySpace[space.id] ?? []) {
      if (member.userId === null || member.userId === input.meUserId) continue;
      // P334: a group where the recorder only reads takes no transfer from them (P293's VIEWER).
      const place: Place | null =
        space.role === "VIEWER"
          ? null
          : {
              spaceId: space.id,
              name: space.name,
              kind: "SHARED",
              currency: space.currency,
              theirMemberId: member.id,
              myMemberId: meIn(space.id),
            };
      const known = byUser.get(member.userId);
      if (known) {
        if (place) known.places.push(place);
        continue;
      }
      const person: Building = {
        memberId: member.id,
        name: member.displayName,
        isGuest: false,
        directSpace: null,
        places: [
          {
            spaceId: null,
            name: null,
            kind: "DIRECT",
            currency: null,
            theirMemberId: null,
            myMemberId: null,
          },
          ...(place ? [place] : []),
        ],
      };
      byUser.set(member.userId, person);
      people.push(person);
    }
  return people.sort((a, b) => a.name.localeCompare(b.name, "es"));
};
