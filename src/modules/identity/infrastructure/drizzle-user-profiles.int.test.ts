import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { DrizzleUserProfiles } from "./drizzle-user-profiles";
import {
  DATE_FORMATS,
  NO_PREFERENCES,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
} from "../domain/preferences";

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

describe("DrizzleUserProfiles formats (HU-E1-15)", () => {
  it("stores no format at first, then only the fields a change names; null clears one", async () => {
    const ana = await userFixture(pool, "Ana");
    expect(await profiles.preferencesOf(ana.id)).toEqual(NO_PREFERENCES);
    await profiles.saveProfile(ana.id, { timeFormat: "H12", locale: "en" });
    await profiles.saveProfile(ana.id, { numberFormat: "SPACE_COMMA", weekStart: "SUNDAY" });
    await profiles.saveProfile(ana.id, { weekStart: null });
    expect(await profiles.preferencesOf(ana.id)).toEqual({
      ...NO_PREFERENCES,
      numberFormat: "SPACE_COMMA",
      timeFormat: "H12",
    });
    const { rows } = await pool.query(`SELECT locale, timezone FROM "user" WHERE id = $1`, [ana.id]);
    expect(rows).toEqual([{ locale: "en", timezone: "America/Bogota" }]);
    expect(await profiles.preferencesOf("nobody")).toEqual(NO_PREFERENCES);
  });

  // The CHECK lists are written by hand in the migration: this pins them to the domain's lists, value by value.
  const everyFormat = [
    ["number_format", NUMBER_FORMATS],
    ["time_format", TIME_FORMATS],
    ["date_format", DATE_FORMATS],
    ["week_start", WEEK_STARTS],
  ] as const;
  it.each(everyFormat.flatMap(([column, values]) => values.map((value) => [column, value] as const)))(
    "accepts %s = %s",
    async (column, value) => {
      const marta = await userFixture(pool, "Marta");
      await expect(
        pool.query(`UPDATE "user" SET ${column} = $1 WHERE id = $2`, [value, marta.id]),
      ).resolves.toMatchObject({ rowCount: 1 });
    },
  );

  it.each([
    ["number_format", "DOT_DOT", "user_number_format"],
    ["time_format", "H13", "user_time_format"],
    ["date_format", "DDMM", "user_date_format"],
    ["week_start", "FRIDAY", "user_week_start"],
  ])("refuses an unknown %s (%s)", async (column, value, constraint) => {
    const luis = await userFixture(pool, "Luis");
    await expect(
      pool.query(`UPDATE "user" SET ${column} = $1 WHERE id = $2`, [value, luis.id]),
    ).rejects.toMatchObject({
      constraint,
    });
  });
});
