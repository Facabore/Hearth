import { canonicalTimeZone, domainError, err, ok, type AuthUser, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import type { UserProfiles } from "./profile";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface SignUpDeps {
  readonly auth: AuthProvider;
  /** Creates everything a new user needs (the personal space, Task 11). */
  readonly provisionUser: (user: AuthUser) => Promise<Result<void>>;
  /** HU-E1-14: stores the browser's zone. */
  readonly profiles: Pick<UserProfiles, "setTimeZone">;
  /** APP_TIMEZONE: the zone of a user whose browser sent none, or one Intl does not know. */
  readonly defaultTimeZone: string;
}

export type SignUp = (input: {
  name: string;
  email: string;
  password: string;
  /** HU-E1-14: the browser's IANA zone; unusable values fall back to APP_TIMEZONE. */
  timezone?: string;
}) => Promise<Result<AuthSession>>;

export const createSignUp =
  (deps: SignUpDeps): SignUp =>
  async ({ timezone, ...input }) => {
    const created = await deps.auth.signUp({ ...input, email: normalizeEmail(input.email) });
    if (!created.ok) return created;
    const { user } = created.value;
    const zone = canonicalTimeZone(timezone ?? "") ?? deps.defaultTimeZone;
    const withZone: AuthUser = { ...user, timezone: zone };
    let cause = "ProfileWriteThrew";
    try {
      if (zone !== user.timezone) await deps.profiles.setTimeZone(user.id, zone);
      cause = "ProvisioningThrew";
      const provisioned = await deps.provisionUser(withZone);
      if (provisioned.ok) return ok({ ...created.value, user: withZone });
      cause = provisioned.error.code;
    } catch {
      // `cause` already names the step that threw.
    }
    // The provider commits the user before provisioning runs; compensate so no half-created user remains.
    try {
      await deps.auth.deleteUser(user.id);
    } catch {
      // The user exists without provisioning; the details let operators find and repair it.
      return err(domainError("InternalError", { cause, compensation: "failed", userId: user.id }));
    }
    return err(domainError("InternalError", { cause }));
  };
