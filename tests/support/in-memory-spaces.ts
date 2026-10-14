import {
  createSpaceAccess,
  type AddMemberOutcome,
  type MemberInSpace,
  type ClaimOutcome,
  type ClaimsDeps,
  type EmailSender,
  type Invitation,
  type InvitationEmail,
  type InvitationRepository,
  type InvitationsDeps,
  type InvitationTokens,
  type RegisteredUsers,
  type Space,
  type SpaceId,
  type SpaceKind,
  type SpaceMember,
  type SpaceMemberId,
  type SpaceMemberRepository,
  type SpaceMembership,
  type SpaceRepository,
  type SpaceRole,
  type SpaceSettings,
  type SpaceSettingsRepository,
  type SpaceSummary,
} from "@/modules/spaces/application";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { directPairKey } from "@/modules/spaces/domain/direct-space";
import type { Clock } from "@/shared/kernel";
import { memoryTm, sequentialIds } from "./fakes";

/** Spaces with their current members; implements every spaces port the use cases need. */
export class InMemorySpaceStore implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository {
  spaces: Space[] = [];
  /** Ids of archived spaces (HU-E1-09); PostgreSQL stores archived_at on the space. */
  readonly archived = new Set<string>();
  /** Pair keys, like spaces.direct_pair_key: stored when a direct space was added or adopted its pair's key. */
  private readonly pairKeys = new Map<string, string>();
  /** Claims applied, in order (PostgreSQL stores claimedAt on the member row). */
  readonly claimed: { spaceId: string; memberId: string; claimedAt: Date }[] = [];
  /** Members who left or were removed, in order (PostgreSQL keeps their rows, with left_at). */
  readonly left: { spaceId: string; memberId: string; leftAt: Date }[] = [];
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

  /** MemberLifecycleRepository: like DrizzleSpaceRepository.markLeft, only a current member of that kind. */
  async markLeft(
    spaceId: string,
    memberId: string,
    kind: SpaceMember["kind"],
    leftAt: Date,
  ): Promise<boolean> {
    if (!this.members(spaceId).some((m) => m.id === memberId && m.kind === kind)) return false;
    this.update(spaceId, (s) => ({ ...s, members: s.members.filter((m) => m.id !== memberId) }));
    this.left.push({ spaceId, memberId, leftAt });
    return true;
  }

  /** GuestClaimRepository, like DrizzleSpaceRepository.spaceKindOf. */
  async spaceKindOf(spaceId: string): Promise<SpaceKind> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`space ${spaceId} does not exist`);
    return space.kind;
  }

  /** GuestClaimRepository, like DrizzleSpaceRepository.claimGuest (pinned against it by its integration test). */
  async claimGuest(spaceId: string, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome> {
    const current = this.members(spaceId);
    if (current.some((m) => m.userId !== null && m.userId === claimed.userId)) return "alreadyMember";
    if (!current.some((m) => m.id === claimed.id && m.kind === "GUEST")) return "notAGuest";
    this.update(spaceId, (s) => ({
      ...s,
      members: s.members.map((m) => (m.id === claimed.id ? claimed : m)),
    }));
    this.claimed.push({ spaceId, memberId: claimed.id, claimedAt });
    return "claimed";
  }

  /** DirectSpaceRepository, like DrizzleSpaceRepository.findCurrentMember. */
  async findCurrentMember(memberId: string): Promise<MemberInSpace | null> {
    for (const space of this.spaces) {
      const member = space.members.find((m) => m.id === memberId);
      if (member) return { spaceId: space.id, spaceKind: space.kind, member };
    }
    return null;
  }

  /** DirectSpaceRepository, like DrizzleSpaceRepository.findByPairKey: an archived space no longer holds its key. */
  async findByPairKey(pairKey: string): Promise<SpaceId | null> {
    const found = [...this.pairKeys].find(([id, key]) => key === pairKey && !this.archived.has(id));
    return found ? (found[0] as SpaceId) : null;
  }

  /** GuestClaimRepository, like DrizzleSpaceRepository.adoptPairKey. */
  async adoptPairKey(spaceId: string, pairKey: string): Promise<boolean> {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (space?.kind !== "DIRECT" || this.archived.has(spaceId) || this.pairKeys.has(spaceId)) return false;
    if ((await this.findByPairKey(pairKey)) !== null) return false;
    this.pairKeys.set(spaceId, pairKey);
    return true;
  }

  /** DirectSpaceRepository, like DrizzleSpaceRepository.addDirect: the pair's active space wins. */
  async addDirect(space: Space): Promise<SpaceId> {
    const key = directPairKey(space);
    const holder = key === null ? null : await this.findByPairKey(key);
    if (holder !== null) return holder;
    this.spaces.push(space);
    if (key !== null) this.pairKeys.set(space.id, key);
    return space.id;
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

export class InMemoryInvitations implements InvitationRepository {
  rows: Invitation[] = [];
  /** Ids of the invitations read for update, in order. */
  readonly locked: string[] = [];

  async add(invitation: Invitation) {
    this.rows.push(invitation);
  }

  async findForUpdate(spaceId: string, invitationId: string) {
    return this.lock(this.rows.find((i) => i.spaceId === spaceId && i.id === invitationId));
  }

  async findByTokenHashForUpdate(tokenHash: string) {
    return this.lock(this.rows.find((i) => i.tokenHash === tokenHash));
  }

  async save(invitation: Invitation) {
    this.rows = this.rows.map((i) => (i.id === invitation.id ? invitation : i));
  }

  /** ClaimLinkRepository, like DrizzleInvitationRepository.revokePendingClaims. */
  async revokePendingClaims(spaceId: string, guestMemberId: string, revokedAt: Date) {
    this.rows = this.rows.map((i): Invitation =>
      i.spaceId === spaceId && i.guestMemberId === guestMemberId && i.status === "PENDING"
        ? { ...i, status: "REVOKED", revokedAt }
        : i,
    );
  }

  private lock(found: Invitation | undefined): Invitation | null {
    if (!found) return null;
    this.locked.push(found.id);
    return found;
  }
}

/** Deterministic tokens `token-1`, `token-2`, …; the hash of a token is `hash(<token>)`. */
export const fakeTokens = (): InvitationTokens => {
  let n = 0;
  return {
    issue: () => {
      const token = `token-${++n}`;
      return { token, hash: `hash(${token})` };
    },
    hash: (token) => `hash(${token})`,
  };
};

/** Records every email; "disabled" resolves false like the v1 composition, "throws" fails like a dead SMTP server. */
export class RecordingEmailSender implements EmailSender {
  readonly sent: InvitationEmail[] = [];
  constructor(private readonly outcome: "sent" | "disabled" | "throws" = "sent") {}

  async send(email: InvitationEmail): Promise<boolean> {
    if (this.outcome === "throws") throw new Error("mail server unavailable");
    this.sent.push(email);
    return this.outcome === "sent";
  }
}

export const registeredUsers = (byEmail: Record<string, string>): RegisteredUsers => {
  const users = new Map(Object.entries(byEmail));
  return { idByEmail: async (email) => users.get(email) ?? null };
};

export class SettableClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}

/**
 * "Household" (`space-household`, members as given, HU-E1-05 Background by default) plus Ana's personal
 * space (`space-ana`), with in-memory invitation adapters; the clock starts at 2026-10-12T12:00:00Z and
 * invitation URLs are `https://hearth.test/invitations/<token>`.
 */
export const invitationsWorld = (
  options: {
    members?: readonly SpaceMember[];
    store?: InMemorySpaceStore;
    emailSender?: RecordingEmailSender;
    users?: Record<string, string>;
  } = {},
) => {
  const store = options.store ?? new InMemorySpaceStore();
  store.seed(householdSpace(options.members));
  store.seed(
    createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now: new Date("2026-10-01T12:00:00Z"),
    }),
  );
  const invitations = new InMemoryInvitations();
  const emailSender = options.emailSender ?? new RecordingEmailSender();
  const clock = new SettableClock(new Date("2026-10-12T12:00:00Z"));
  const tokens = fakeTokens();
  const ids = sequentialIds("id");
  const deps: InvitationsDeps = {
    access: createSpaceAccess(store),
    members: store,
    spaces: store,
    invitations,
    tokens,
    emailSender,
    users: registeredUsers(options.users ?? {}),
    invitationUrl: (token) => `https://hearth.test/invitations/${token}`,
    ids,
    clock,
    tm: memoryTm,
  };
  // HU-E1-11: claim links share the store, tokens, ids and clock of the invitations above.
  const claims: ClaimsDeps = {
    access: deps.access,
    members: store,
    claims: store,
    invitations,
    tokens,
    claimUrl: (token) => `https://hearth.test/claims/${token}`,
    ids,
    clock,
    tm: memoryTm,
  };
  return { store, invitations, emailSender, clock, deps, claims };
};
