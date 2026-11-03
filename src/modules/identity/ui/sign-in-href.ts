/** A visitor's screen with where the visitor was going (`next`, already made safe) and the invitation they hold. */
const visitorHrefOf = (path: string, next: string, invitation: string | undefined): string => {
  const query = [
    next === "/" ? null : `next=${encodeURIComponent(next)}`,
    invitation === undefined ? null : `invitation=${encodeURIComponent(invitation)}`,
  ].filter((part): part is string => part !== null);
  return query.length === 0 ? path : `${path}?${query.join("&")}`;
};

/** Ruling P157 and N5: the way back to sign in keeps where the visitor was going and the invitation they hold. */
export const signInHrefOf = (next: string, invitation: string | undefined): string =>
  visitorHrefOf("/sign-in", next, invitation);

/** Ruling P290: the way back to sign-up from the trust page, keeping the same two. */
export const signUpHrefOf = (next: string, invitation: string | undefined): string =>
  visitorHrefOf("/sign-up", next, invitation);

/** Ruling P290: the trust page opened from sign-up carries the same two, so its way back loses neither. */
export const trustHrefOf = (next: string, invitation: string | undefined): string =>
  visitorHrefOf("/trust", next, invitation);
