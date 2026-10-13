import type {
  AddMemberOutcome,
  Space,
  SpaceId,
  SpaceMember,
  SpaceMemberId,
  SpaceMemberRepository,
  SpaceMembership,
  SpaceRepository,
  SpaceRole,
  SpaceSettings,
  SpaceSettingsRepository,
  SpaceSummary,
} from "@/modules/spaces/application";

/** Spaces with their current members; implements every spaces port the use cases need. */
export class InMemorySpaceStore implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository {
  spaces: Space[] = [];
  /** Space ids whose members were read with `lock: true`, in order. */
  readonly locked: string[] = [];

  async add(space: Space) {
    this.spaces.push(space);
  }

  async hasPersonalSpace(userId: string) {
    return this.spaces.some((s) => s.kind === "PERSONAL" && s.personalOwnerUserId === userId);
  }

  async listForUser(userId: string): Promise<SpaceSummary[]> {
    return this.spaces.flatMap((s) => {
      const me = s.members.find((m) => m.userId === userId);
      return me
        ? [
            {
              id: s.id,
              name: s.name,
              kind: s.kind,
              currency: s.currency,
              periodPolicy: s.periodPolicy,
              role: me.role,
            },
          ]
        : [];
    });
  }

  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {
    const space = this.spaces.find((s) => s.id === spaceId);
    const me = space?.members.find((m) => m.userId === userId);
    if (!space || !me) return null;
    return {
      spaceId: space.id,
      name: space.name,
      spaceKind: space.kind,
      currency: space.currency,
      periodPolicy: space.periodPolicy,
      memberId: me.id,
      userId,
      role: me.role,
    };
  }

  async updateSettings(spaceId: SpaceId, settings: SpaceSettings) {
    this.update(spaceId, (s) => ({ ...s, ...settings }));
  }

  async listCurrent(spaceId: string, options: { readonly lock?: boolean } = {}): Promise<SpaceMember[]> {
    if (options.lock) this.locked.push(spaceId);
    return this.members(spaceId);
  }

  async addMember(spaceId: string, member: SpaceMember): Promise<AddMemberOutcome> {
    const current = this.members(spaceId);
    if (member.userId !== null && current.some((m) => m.userId === member.userId)) return "alreadyMember";
    if (current.some((m) => m.displayName.toLowerCase() === member.displayName.toLowerCase()))
      return "nameTaken";
    this.update(spaceId, (s) => ({ ...s, members: [...s.members, member] }));
    return "added";
  }

  async updateRole(spaceId: string, memberId: SpaceMemberId, role: SpaceRole) {
    this.update(spaceId, (s) => ({
      ...s,
      members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)),
    }));
  }

  /** Test setup: a space as earlier use cases would have left it. */
  seed(space: Space): Space {
    this.spaces.push(space);
    return space;
  }

  members(spaceId: string): SpaceMember[] {
    return [...(this.spaces.find((s) => s.id === spaceId)?.members ?? [])];
  }

  private update(spaceId: string, change: (space: Space) => Space) {
    this.spaces = this.spaces.map((s) => (s.id === spaceId ? change(s) : s));
  }
}

/** `member-<name>`; a USER `u-<name>` with `role`, or a GUEST when `role` is null; joined `minutes` after 2026-10-01 12:00Z. */
export const memberOf = (name: string, role: SpaceRole | null, minutes: number): SpaceMember => ({
  id: `member-${name.toLowerCase()}` as SpaceMemberId,
  kind: role === null ? "GUEST" : "USER",
  userId: role === null ? null : `u-${name.toLowerCase()}`,
  displayName: name,
  role,
  contactEmail: null,
  joinedAt: new Date(Date.UTC(2026, 9, 1, 12, minutes)),
});

/** HU-E1-05 Background, in join order: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro. */
export const HOUSEHOLD_MEMBERS: readonly SpaceMember[] = [
  memberOf("Ana", "OWNER", 0),
  memberOf("Juan", "ADMIN", 1),
  memberOf("Luis", "MEMBER", 2),
  memberOf("Sofi", "VIEWER", 3),
  memberOf("Pedro", null, 4),
];

/** The shared space "Household" (`space-household`, COP, MONTHLY(1)) with the given current members. */
export const householdSpace = (members: readonly SpaceMember[] = HOUSEHOLD_MEMBERS): Space => ({
  id: "space-household" as SpaceId,
  name: "Household",
  kind: "SHARED",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  personalOwnerUserId: null,
  members: [...members],
  createdAt: new Date("2026-10-01T12:00:00Z"),
});
