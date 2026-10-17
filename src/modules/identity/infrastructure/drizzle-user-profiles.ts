import { eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { canonicalTimeZone, type UserTimeZones } from "@/shared/kernel";
import type { UserProfiles } from "../application/profile";
import { user } from "./auth.schema";

/** HU-E1-14: the zone on Better Auth's `user` row; read inside the caller's transaction when there is one. */
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
}
