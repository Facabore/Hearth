import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { canonicalTimeZone, type UserTimeZones } from "@/shared/kernel";
import type { UserProfiles } from "../application/profile";
import { NO_PREFERENCES, type ProfileChange, type StoredPreferences } from "../domain/preferences";
import { user } from "./auth.schema";

/**
 * HU-E1-14, HU-E1-15: the zone, the language and the formats on Better Auth's `user` row; read and written inside the
 * caller's transaction when there is one.
 */
export class DrizzleUserProfiles implements UserProfiles, UserTimeZones {
  constructor(
    private readonly tm: DrizzleTransactionManager,
    /** APP_TIMEZONE. */
    private readonly fallback: string,
  ) {}

  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.tm
      .executor()
      .update(user)
      .set({ timezone: timeZone, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }

  async timeZoneOf(userId: string): Promise<string> {
    const [row] = await this.tm
      .executor()
      .select({ timezone: user.timezone })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    // Ruling P45: never hand a caller a zone Intl would throw on.
    return canonicalTimeZone(row?.timezone ?? "") ?? this.fallback;
  }

  /** HU-E1-15: the four formats as stored; an unknown user stores none. */
  async preferencesOf(userId: string): Promise<StoredPreferences> {
    const [row] = await this.tm
      .executor()
      .select({
        numberFormat: user.numberFormat,
        timeFormat: user.timeFormat,
        dateFormat: user.dateFormat,
        weekStart: user.weekStart,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row ?? NO_PREFERENCES;
  }

  /** HU-E1-15: one UPDATE; drizzle leaves the undefined fields out of SET, and null clears a format. */
  async saveProfile(userId: string, fields: ProfileChange): Promise<void> {
    await this.tm
      .executor()
      .update(user)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }
}
