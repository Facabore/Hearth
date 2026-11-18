import { eq, inArray, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { canonicalTimeZone, type UserTimeZones } from "@/shared/kernel";
import type { HandleHolder, UserHandles } from "../application/handles";
import type { UserProfiles } from "../application/profile";
import { NO_PREFERENCES, type ProfileChange, type StoredPreferences } from "../domain/preferences";
import { user } from "./auth.schema";

/**
 * HU-E1-14, HU-E1-15: the zone, the language and the formats on Better Auth's `user` row; read and written inside the
 * caller's transaction when there is one.
 */
export class DrizzleUserProfiles implements UserProfiles, UserTimeZones, UserHandles {
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

  /** D29, slice MC4: the stored display currency; an unknown user, or one who chose none, has null. */
  async displayCurrencyOf(userId: string): Promise<string | null> {
    const [row] = await this.tm
      .executor()
      .select({ displayCurrency: user.displayCurrency })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.displayCurrency ?? null;
  }

  /** P342: the stored favorite currencies in their order; an unknown user, or one who chose none yet, has null. */
  async favoriteCurrenciesOf(userId: string): Promise<readonly string[] | null> {
    const [row] = await this.tm
      .executor()
      .select({ favoriteCurrencies: user.favoriteCurrencies })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.favoriteCurrencies ?? null;
  }

  /** HU-E1-15: one UPDATE; drizzle leaves the undefined fields out of SET, and null clears a format. */
  async saveProfile(userId: string, { favoriteCurrencies, ...fields }: ProfileChange): Promise<void> {
    await this.tm
      .executor()
      .update(user)
      .set({
        ...fields,
        ...(favoriteCurrencies === undefined ? {} : { favoriteCurrencies: [...favoriteCurrencies] }),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));
  }

  /**
   * D27: what the referrals module reads of accounts: the name, whether the email is confirmed (issue #86) and when the
   * account was created. Unknown ids are left out.
   */
  async accountsOf(
    userIds: readonly string[],
  ): Promise<{ id: string; name: string; emailVerified: boolean; createdAt: Date }[]> {
    if (userIds.length === 0) return [];
    return this.tm
      .executor()
      .select({ id: user.id, name: user.name, emailVerified: user.emailVerified, createdAt: user.createdAt })
      .from(user)
      .where(inArray(user.id, [...userIds]));
  }

  /** Ruling P339: the stored handle; an unknown user, or one who picked none, has null. */
  async handleOf(userId: string): Promise<string | null> {
    const [row] = await this.tm
      .executor()
      .select({ handle: user.handle })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.handle ?? null;
  }

  /**
   * Ruling P339: one UPDATE in a savepoint, since the unique index on lower(handle) refuses one that someone else took
   * meanwhile, and a refused statement would otherwise abort the caller's transaction.
   */
  async setHandle(userId: string, handle: string | null): Promise<"saved" | "taken"> {
    try {
      await this.tm
        .executor()
        .transaction((savepoint) =>
          savepoint.update(user).set({ handle, updatedAt: new Date() }).where(eq(user.id, userId)),
        );
      return "saved";
    } catch (error) {
      const { code, constraint } = ((error as Error).cause ?? error) as {
        code?: unknown;
        constraint?: unknown;
      };
      if (code === "23505" && constraint === "user_handle_uq") return "taken";
      throw error;
    }
  }

  /** Ruling P339: exact match ignoring case, through the unique index. */
  async findByHandle(handle: string): Promise<HandleHolder | null> {
    const [row] = await this.tm
      .executor()
      .select({ userId: user.id, handle: user.handle, displayName: user.name })
      .from(user)
      .where(eq(sql`lower(${user.handle})`, handle.toLowerCase()))
      .limit(1);
    return row?.handle ? { userId: row.userId, handle: row.handle, displayName: row.displayName } : null;
  }

  /** Ruling P339: the handle and name of each known id, for the friend requests' lists. */
  async holdersOf(
    userIds: readonly string[],
  ): Promise<{ userId: string; handle: string | null; displayName: string }[]> {
    if (userIds.length === 0) return [];
    return this.tm
      .executor()
      .select({ userId: user.id, handle: user.handle, displayName: user.name })
      .from(user)
      .where(inArray(user.id, [...userIds]));
  }
}
