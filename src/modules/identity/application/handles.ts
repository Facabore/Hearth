import { domainError, err, ok, type Result } from "@/shared/kernel";
import { parseHandle } from "../domain/handle";

/** Ruling P339: a person as an @usuario finds them: the handle and the name, never anything else. */
export interface HandleHolder {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
}

/** Ruling P339: where each person's @usuario lives (the provider's `user` row), unique ignoring case. */
export interface UserHandles {
  /** The person's handle; null when they have none, or for an unknown user. */
  handleOf(userId: string): Promise<string | null>;
  /** Sets or clears the handle; "taken" when someone else holds it ignoring case, decided by the database. */
  setHandle(userId: string, handle: string | null): Promise<"saved" | "taken">;
  /** The person holding exactly this handle, ignoring case, or null. */
  findByHandle(handle: string): Promise<HandleHolder | null>;
  /** The handle and name of each known id; unknown ids are left out. */
  holdersOf(
    userIds: readonly string[],
  ): Promise<{ userId: string; handle: string | null; displayName: string }[]>;
}

/** Ruling P339: how many lookups a person makes; false once they made too many in the current window. */
export interface HandleLookupThrottle {
  allows(userId: string): boolean;
}

export type FindUserByHandle = (input: {
  readonly userId: string;
  readonly handle: string;
}) => Promise<Result<{ readonly handle: string; readonly displayName: string }>>;

/**
 * Ruling P339 (S3): someone found only by their exact @, ignoring case, with no listing, no prefix and no "did you
 * mean". The answer carries the handle and the name alone; an unknown or malformed handle, and the caller's own, are
 * all UserNotFound, so nothing else is revealed. Throttled per person, as the sign-in lookups are per address.
 */
export const createFindUserByHandle =
  (deps: {
    readonly handles: Pick<UserHandles, "findByHandle">;
    readonly throttle: HandleLookupThrottle;
  }): FindUserByHandle =>
  async ({ userId, handle }) => {
    if (!deps.throttle.allows(userId)) return err(domainError("TooManyRequests"));
    const parsed = parseHandle(handle);
    if (!parsed.ok) return err(domainError("UserNotFound"));
    const holder = await deps.handles.findByHandle(parsed.value);
    if (holder === null || holder.userId === userId) return err(domainError("UserNotFound"));
    return ok({ handle: holder.handle, displayName: holder.displayName });
  };
