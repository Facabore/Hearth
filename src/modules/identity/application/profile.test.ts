import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { createUpdateProfile, type UserProfiles } from "./profile";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const world = () => {
  const stored = new Map<string, string>();
  const profiles: UserProfiles = { setTimeZone: async (userId, zone) => void stored.set(userId, zone) };
  return { stored, update: createUpdateProfile({ profiles }) };
};

describe("UpdateProfile (HU-E1-14)", () => {
  it("changes my time zone, stored by its canonical name", async () => {
    const { stored, update } = world();
    expect(unwrap(await update({ user: ana, timezone: "america/new_york" })).timezone).toBe(
      "America/New_York",
    );
    expect(stored.get("u-ana")).toBe("America/New_York");
  });

  it("refuses an unknown zone and keeps mine", async () => {
    const { stored, update } = world();
    expect(codeOf(await update({ user: ana, timezone: "Bogota" }))).toBe("InvalidTimeZone");
    expect(stored.size).toBe(0);
  });

  it("changes nothing without a zone, or with the zone I already have", async () => {
    const { stored, update } = world();
    expect(unwrap(await update({ user: ana }))).toEqual(ana);
    expect(unwrap(await update({ user: ana, timezone: "America/Bogota" }))).toEqual(ana);
    expect(stored.size).toBe(0);
  });
});
