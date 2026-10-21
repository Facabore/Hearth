import { domainError, err, ok, parseTimeZone, type AuthUser, type Result } from "@/shared/kernel";
import {
  effectivePreferences,
  formatsIn,
  lockedFieldsIn,
  type FormatPreferences,
  type Locale,
  type LockableField,
  type ProfileChange,
  type StoredPreferences,
} from "../domain/preferences";
import type { InstallationRulesReader } from "./installation-rules";

/** HU-E1-14, HU-E1-15: where a user's own settings live (the provider's `user` row). */
export interface UserProfiles {
  setTimeZone(userId: string, timeZone: string): Promise<void>;
  /** HU-E1-15: the four formats as stored; null follows the installation rule. */
  preferencesOf(userId: string): Promise<StoredPreferences>;
  /** HU-E1-15: writes the fields present, in one go; a null format returns to the rule. */
  saveProfile(userId: string, fields: ProfileChange): Promise<void>;
}

/** HU-E1-15: the profile that `GET` and `PATCH /api/v1/me` answer. */
export interface ProfileView {
  readonly user: AuthUser;
  readonly preferences: {
    readonly stored: StoredPreferences;
    readonly effective: FormatPreferences;
    readonly defaults: FormatPreferences & { readonly timezone: string; readonly locale: Locale };
    readonly locked: readonly LockableField[];
  };
}

export type GetProfile = (input: { readonly user: AuthUser }) => Promise<Result<ProfileView>>;

/** HU-E1-15: the stored formats, the rules' defaults and locks, and what applies; never derived from `locale` (D23). */
export const createGetProfile =
  (deps: {
    readonly profiles: Pick<UserProfiles, "preferencesOf">;
    readonly rules: InstallationRulesReader;
    readonly regionDefaults: { readonly timezone: string; readonly locale: Locale };
  }): GetProfile =>
  async ({ user }) => {
    const [stored, rules] = await Promise.all([deps.profiles.preferencesOf(user.id), deps.rules.rules()]);
    return ok({
      user,
      preferences: {
        stored,
        effective: effectivePreferences(stored, rules),
        defaults: { ...rules.defaults, ...deps.regionDefaults },
        locked: rules.locked,
      },
    });
  };

export type UpdateProfile = (input: { readonly user: AuthUser } & ProfileChange) => Promise<Result<AuthUser>>;

/**
 * HU-E1-14, HU-E1-15: the signed-in user changes their own zone, language and formats. A change that names a locked
 * field is PreferenceLocked, even to clear it or to repeat its value; then an unknown zone is InvalidTimeZone. Nothing
 * is written unless the whole change passes, and a zone or a language equal to the current one is not written.
 */
export const createUpdateProfile =
  (deps: {
    readonly profiles: Pick<UserProfiles, "saveProfile">;
    readonly rules: InstallationRulesReader;
  }): UpdateProfile =>
  async ({ user, ...change }) => {
    // The check lives here, never only in the handler (HU-E1-15).
    const locked = lockedFieldsIn(change, await deps.rules.rules());
    if (locked.length > 0) return err(domainError("PreferenceLocked", { fields: locked }));
    const zone = change.timezone === undefined ? ok(user.timezone) : parseTimeZone(change.timezone);
    if (!zone.ok) return zone;
    const locale = change.locale ?? user.locale;
    const fields: ProfileChange = {
      ...(zone.value === user.timezone ? {} : { timezone: zone.value }),
      ...(locale === user.locale ? {} : { locale: change.locale }),
      ...formatsIn(change),
    };
    if (Object.keys(fields).length > 0) await deps.profiles.saveProfile(user.id, fields);
    return ok({ ...user, timezone: zone.value, locale });
  };
