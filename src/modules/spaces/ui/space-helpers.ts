import type { SpaceDto } from "@/shared/ui/api/dto";

export type SpaceSummary = Pick<SpaceDto, "id" | "name" | "kind" | "role">;

/** Sign-up creates the personal space, so a signed-in person always has one. */
export const personalSpaceOf = (spaces: readonly SpaceDto[]): SpaceDto => {
  const personal = spaces.find((space) => space.kind === "PERSONAL");
  if (!personal) throw new Error("The signed-in person has no personal space");
  return personal;
};

/** Ruling P125: the URL's space; the personal one without an id; null for a space the person does not belong to. */
export const activeSpaceOf = (spaces: readonly SpaceDto[], spaceId: string | null): SpaceDto | null =>
  spaceId === null ? personalSpaceOf(spaces) : (spaces.find((space) => space.id === spaceId) ?? null);
