import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";

/** HU-E1-13, ruling P172: someone to split one expense with. */
export interface Person {
  readonly memberId: string;
  readonly name: string;
  readonly isGuest: boolean;
  /** The name of the direct space the split will use, or null when the API creates one. */
  readonly directSpace: string | null;
}

/**
 * The people the recorder shares a space with: the other member of each direct space (a guest included, D15: a guest
 * exists only in its own space), then each registered co-member of a shared space once, unless a direct space already
 * holds them. Shared spaces' guests are left out: the API refuses them (InvalidDirectCounterpart).
 */
export const peopleOf = (input: {
  readonly meUserId: string;
  readonly spaces: readonly SpaceDto[];
  readonly membersBySpace: Readonly<Record<string, readonly MemberDto[]>>;
}): Person[] => {
  const people: Person[] = [];
  const covered = new Set<string>();
  for (const space of input.spaces.filter((s) => s.kind === "DIRECT")) {
    const other = (input.membersBySpace[space.id] ?? []).find((m) => m.userId !== input.meUserId);
    if (!other) continue;
    if (other.userId) covered.add(other.userId);
    people.push({
      memberId: other.id,
      name: other.displayName,
      isGuest: other.kind === "GUEST",
      directSpace: space.name,
    });
  }
  for (const space of input.spaces.filter((s) => s.kind === "SHARED"))
    for (const member of input.membersBySpace[space.id] ?? []) {
      if (member.userId === null || member.userId === input.meUserId || covered.has(member.userId)) continue;
      covered.add(member.userId);
      people.push({ memberId: member.id, name: member.displayName, isGuest: false, directSpace: null });
    }
  return people.sort((a, b) => a.name.localeCompare(b.name, "es"));
};
