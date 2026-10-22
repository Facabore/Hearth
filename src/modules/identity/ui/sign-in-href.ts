/** Ruling P157 and N5: the way back to sign in keeps where the visitor was going and the invitation they hold. */
export const signInHrefOf = (next: string, invitation: string | undefined): string => {
  const query = [
    next === "/" ? null : `next=${encodeURIComponent(next)}`,
    invitation === undefined ? null : `invitation=${encodeURIComponent(invitation)}`,
  ].filter((part): part is string => part !== null);
  return query.length === 0 ? "/sign-in" : `/sign-in?${query.join("&")}`;
};
