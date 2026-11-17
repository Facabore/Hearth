/**
 * Ruling P339 (S6): the @ of a friend link (`/f/<handle>`), kept until Amigos opens Agregar amigo with it, once. A
 * visitor keeps it on this device across the sign-up or the sign-in (as D27 keeps a referral code); a signed-in person
 * keeps it only for the redirect to Amigos. The storage may be missing or refuse (a private window, blocked site data):
 * this tab's memory still carries it.
 */
const KEY = "hearth.friendLink";
/** What an @ can look like on the wire (S2), in any case; anything else is never kept, and the API decides. */
const SHAPE = /^@?[A-Za-z0-9_]{3,20}$/;

let kept: string | undefined;

export const rememberFriendLink = (handle: string): void => {
  if (!SHAPE.test(handle)) return;
  kept = handle.replace(/^@/, "").toLowerCase();
  try {
    localStorage.setItem(KEY, kept);
  } catch {
    // Kept in this tab only.
  }
};

/** The @ kept, if any, without forgetting it. */
export const rememberedFriendLink = (): string | undefined => {
  if (kept !== undefined) return kept;
  try {
    const stored = localStorage.getItem(KEY);
    return stored !== null && SHAPE.test(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
};

export const forgetFriendLink = (): void => {
  kept = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
};

/** Where a person who just signed up or in goes with a kept @: the link again, which opens Amigos with it. */
export const friendLinkNext = (): string | undefined => {
  const handle = rememberedFriendLink();
  return handle === undefined ? undefined : `/f/${handle}`;
};
