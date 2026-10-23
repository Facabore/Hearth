import { domainError, err, ok, writableTimeZone, type AuthUser, type Result } from "@/shared/kernel";
import type { Locale } from "../domain/preferences";
import type { AuthProvider, AuthSession } from "./auth-provider";
import type { UserProfiles } from "./profile";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Ruling P143: HEARTH_SIGN_UP. A closed installation is invite-only; the composition root binds `admits` to the
 * spaces module, which identity never imports.
 */
export interface SignUpGate {
  readonly mode: "open" | "closed";
  /** Whether `token` names a usable invitation for `email` (already normalized). */
  admits(input: { token: string; email: string }): Promise<boolean>;
}

export interface SignUpDeps {
  readonly auth: AuthProvider;
  /** Creates everything a new user needs (the personal space, Task 11). */
  readonly provisionUser: (user: AuthUser) => Promise<Result<void>>;
  /** HU-E1-14: stores the browser's zone; ruling P142: the visitor's language. */
  readonly profiles: Pick<UserProfiles, "setTimeZone" | "saveProfile">;
  /** APP_TIMEZONE: the zone of a user whose browser sent none, or one Intl does not know. */
  readonly defaultTimeZone: string;
  readonly signUpGate: SignUpGate;
}

export type SignUp = (input: {
  name: string;
  email: string;
  password: string;
  /** HU-E1-14: the browser's IANA zone; unusable values fall back to APP_TIMEZONE. */
  timezone?: string;
  /** Ruling P142: the language the visitor used on the sign-up screen; absent keeps the stored default. */
  locale?: Locale;
  /** Ruling P143: the invitation or claim link token that lets a visitor sign up while sign-up is closed. */
  invitationToken?: string;
}) => Promise<Result<AuthSession>>;

export const createSignUp =
  (deps: SignUpDeps): SignUp =>
  async ({ timezone, locale, invitationToken, ...input }) => {
    const email = normalizeEmail(input.email);
    // Before the provider creates the user: a refusal leaves no row, and never says why (ruling P143).
    if (deps.signUpGate.mode === "closed") {
      const admitted =
        invitationToken !== undefined && (await deps.signUpGate.admits({ token: invitationToken, email }));
      if (!admitted) return err(domainError("SignUpClosed"));
    }
    const created = await deps.auth.signUp({ ...input, email });
    if (!created.ok) return created;
    const { user } = created.value;
    const zone = writableTimeZone(timezone ?? "") ?? deps.defaultTimeZone;
    const language = locale ?? (user.locale as Locale);
    const withProfile: AuthUser = { ...user, timezone: zone, locale: language };
    let cause = "ProfileWriteThrew";
    try {
      if (zone !== user.timezone) await deps.profiles.setTimeZone(user.id, zone);
      if (language !== user.locale) await deps.profiles.saveProfile(user.id, { locale: language });
      cause = "ProvisioningThrew";
      const provisioned = await deps.provisionUser(withProfile);
      if (provisioned.ok) return ok({ ...created.value, user: withProfile });
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
