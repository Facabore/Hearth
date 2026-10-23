import type { SpaceDto } from "@/shared/ui/api/dto";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";

export type SpaceSummary = Pick<SpaceDto, "id" | "name" | "kind" | "role">;

/** Sign-up creates the personal space, so a signed-in person always has one. */
export const personalSpaceOf = (spaces: readonly SpaceDto[]): SpaceDto => {
  const personal = spaces.find((space) => space.kind === "PERSONAL");
  if (!personal) throw new Error("The signed-in person has no personal space");
  return personal;
};

/**
 * Ruling P125: the URL's space; null for a space the person does not belong to. Without an id (Settings, New space)
 * it is the space `?from=` names when that is one of hers (N3), else the personal one.
 */
export const activeSpaceOf = (
  spaces: readonly SpaceDto[],
  spaceId: string | null,
  from?: string,
): SpaceDto | null =>
  spaceId === null
    ? (spaces.find((space) => space.id === from) ?? personalSpaceOf(spaces))
    : (spaces.find((space) => space.id === spaceId) ?? null);

/**
 * Where Volver goes from a screen the personal shell wraps (Settings, New space): the home of the space the person
 * came from (`?from=`), or the personal one when there is none or it is not one of hers.
 */
export const spaceHomeHref = (spaces: readonly SpaceDto[], from: string | undefined): string =>
  `/spaces/${(spaces.find((space) => space.id === from) ?? personalSpaceOf(spaces)).id}`;

/**
 * The parent route of New space, which a deep link or a new tab follows: the screen its create link started from
 * (`returnTo`, a same-origin path), else the home of `?from=`'s space. Saving does not use it: the person lands in
 * the space she created.
 */
export const newSpaceBackHref = (
  spaces: readonly SpaceDto[],
  from: string | undefined,
  returnTo: string | undefined,
): string => safeReturnTo(returnTo) ?? spaceHomeHref(spaces, from);
