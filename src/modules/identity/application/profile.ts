import { ok, parseTimeZone, type AuthUser, type Result } from "@/shared/kernel";

/** HU-E1-14: where a user's own settings live (the provider's `user` row). */
export interface UserProfiles {
  setTimeZone(userId: string, timeZone: string): Promise<void>;
}

export type UpdateProfile = (input: {
  readonly user: AuthUser;
  readonly timezone?: string;
}) => Promise<Result<AuthUser>>;

/** HU-E1-14: the signed-in user changes their own zone; an unknown zone sent explicitly is InvalidTimeZone. */
export const createUpdateProfile =
  (deps: { readonly profiles: UserProfiles }): UpdateProfile =>
  async (input) => {
    if (input.timezone === undefined) return ok(input.user);
    const zone = parseTimeZone(input.timezone);
    if (!zone.ok) return zone;
    if (zone.value !== input.user.timezone) await deps.profiles.setTimeZone(input.user.id, zone.value);
    return ok({ ...input.user, timezone: zone.value });
  };
