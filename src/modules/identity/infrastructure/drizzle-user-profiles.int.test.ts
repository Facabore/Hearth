import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { DrizzleUserProfiles } from "./drizzle-user-profiles";

const { db, pool } = testDatabase();
const profiles = new DrizzleUserProfiles(new DrizzleTransactionManager(db), "America/Bogota");

afterAll(() => pool.end());

describe("DrizzleUserProfiles (HU-E1-14)", () => {
  it("stores a user's zone and reads it back", async () => {
    const juan = await userFixture(pool, "Juan");
    expect(await profiles.timeZoneOf(juan.id)).toBe("America/Bogota");
    await profiles.setTimeZone(juan.id, "Europe/Madrid");
    expect(await profiles.timeZoneOf(juan.id)).toBe("Europe/Madrid");
  });

  it("answers the deployment zone for an unknown user and for a stored value Intl refuses", async () => {
    expect(await profiles.timeZoneOf("nobody")).toBe("America/Bogota");
    const luis = await userFixture(pool, "Luis");
    await pool.query(`UPDATE "user" SET timezone = 'Mars/Olympus' WHERE id = $1`, [luis.id]);
    expect(await profiles.timeZoneOf(luis.id)).toBe("America/Bogota");
  });
});
