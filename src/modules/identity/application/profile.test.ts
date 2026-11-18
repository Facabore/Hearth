import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  BUILT_IN_RULES,
  NO_PREFERENCES,
  formatsIn,
  type InstallationRules,
  type Locale,
  type LockableField,
  type ProfileChange,
  type StoredPreferences,
} from "../domain/preferences";
import { createGetProfile, createUpdateProfile, type UserProfiles } from "./profile";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};

/** Profiles in memory as DrizzleUserProfiles keeps them; `writes` records every save. */
const world = (
  rules: InstallationRules = BUILT_IN_RULES,
  regionDefaults: { timezone: string; locale: Locale } = { timezone: "America/Bogota", locale: "es" },
) => {
  const stored = new Map<string, StoredPreferences>();
  const currencies = new Map<string, string | null>();
  const favorites = new Map<string, readonly string[]>();
  const writes: [string, ProfileChange][] = [];
  const profiles: UserProfiles = {
    setTimeZone: async () => undefined,
    preferencesOf: async (userId) => stored.get(userId) ?? NO_PREFERENCES,
    displayCurrencyOf: async (userId) => currencies.get(userId) ?? null,
    favoriteCurrenciesOf: async (userId) => favorites.get(userId) ?? null,
    saveProfile: async (userId, fields) => {
      writes.push([userId, fields]);
      stored.set(userId, { ...(stored.get(userId) ?? NO_PREFERENCES), ...formatsIn(fields) });
      if (fields.displayCurrency !== undefined) currencies.set(userId, fields.displayCurrency);
      if (fields.favoriteCurrencies !== undefined) favorites.set(userId, fields.favoriteCurrencies);
    },
  };
  // Ruling P343: every user has a handle (a random one until they change it); `handleWrites` records every change.
  const handleOf = new Map<string, string>([[ana.id, "ana_4821"]]);
  const handleWrites: [string, string][] = [];
  const handles = {
    handleOf: async (userId: string) => handleOf.get(userId) ?? `u_${userId.replace(/[^a-z0-9]/g, "")}`,
    setHandle: async (userId: string, handle: string) => {
      handleWrites.push([userId, handle]);
      handleOf.set(userId, handle);
      return "saved" as const;
    },
  };
  let current = rules;
  const reader = { rules: async () => current };
  const getProfile = createGetProfile({
    profiles,
    handles,
    rules: reader,
    regionDefaults,
  });
  return {
    writes,
    handleWrites,
    profileOf: async (user: AuthUser = ana) => unwrap(await getProfile({ user })),
    /** Replaces the installation's locks, as HU-E8-18 will when an administrator locks or lifts a field. */
    lock: (locked: readonly LockableField[]) => {
      current = { ...current, locked };
    },
    update: createUpdateProfile({ profiles, handles, rules: reader }),
    preferencesOf: async (user: AuthUser = ana) => unwrap(await getProfile({ user })).preferences,
  };
};

describe("the installation's zone and language (HU-E9-13, ruling P124)", () => {
  it("are the installation's, never the person's own", async () => {
    const { preferencesOf } = world(BUILT_IN_RULES, { timezone: "Europe/Madrid", locale: "en" });
    expect(ana.timezone).toBe("America/Bogota");
    expect(ana.locale).toBe("es");
    expect((await preferencesOf()).defaults).toEqual({
      ...BUILT_IN_RULES.defaults,
      timezone: "Europe/Madrid",
      locale: "en",
    });
  });
});

describe("UpdateProfile (HU-E1-14)", () => {
  it("changes my time zone, stored by its canonical name", async () => {
    const { writes, update } = world();
    expect(unwrap(await update({ user: ana, timezone: "america/new_york" })).timezone).toBe(
      "America/New_York",
    );
    expect(writes).toEqual([["u-ana", { timezone: "America/New_York" }]]);
  });

  it("refuses an unknown zone and keeps mine", async () => {
    const { writes, update } = world();
    expect(codeOf(await update({ user: ana, timezone: "Bogota" }))).toBe("InvalidTimeZone");
    expect(writes).toEqual([]);
  });

  it("changes nothing without a change, or with the zone and the language I already have", async () => {
    const { writes, update } = world();
    expect(unwrap(await update({ user: ana }))).toEqual(ana);
    expect(unwrap(await update({ user: ana, timezone: "America/Bogota", locale: "es" }))).toEqual(ana);
    expect(writes).toEqual([]);
  });
});

describe("formatting preferences (HU-E1-15)", () => {
  const RULES = BUILT_IN_RULES.defaults;

  it("follow the installation rules without an override, with nothing locked", async () => {
    expect(await world().preferencesOf()).toEqual({
      stored: NO_PREFERENCES,
      effective: RULES,
      defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },
      locked: [],
      displayCurrency: null,
      favoriteCurrencies: null,
    });
  });

  it("let one person override the time format while the others keep the rule", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, timeFormat: "H12" }));
    const mine = await preferencesOf();
    expect([mine.stored, mine.effective]).toEqual([
      { ...NO_PREFERENCES, timeFormat: "H12" },
      { ...RULES, timeFormat: "H12" },
    ]);
    expect((await preferencesOf({ ...ana, id: "u-juan", name: "Juan" })).effective.timeFormat).toBe("H24");
  });

  it("stay as they are when the language changes", async () => {
    const { writes, update, preferencesOf } = world();
    unwrap(await update({ user: ana, numberFormat: "COMMA_DOT", timeFormat: "H12" }));
    const english = unwrap(await update({ user: ana, locale: "en" }));
    expect(english.locale).toBe("en");
    expect(writes.at(-1)).toEqual(["u-ana", { locale: "en" }]);
    expect((await preferencesOf(english)).effective).toEqual({
      ...RULES,
      numberFormat: "COMMA_DOT",
      timeFormat: "H12",
    });
  });

  it("return to the rule when set to null", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, timeFormat: "H12" }));
    unwrap(await update({ user: ana, timeFormat: null }));
    const { stored, effective } = await preferencesOf();
    expect([stored.timeFormat, effective.timeFormat]).toEqual([null, "H24"]);
  });

  it("refuse a locked field, even to clear it or to repeat its value, and write nothing (PreferenceLocked)", async () => {
    const { writes, update, preferencesOf } = world({
      ...BUILT_IN_RULES,
      locked: ["dateFormat", "timezone"],
    });
    const changes: ProfileChange[] = [
      { dateFormat: "MDY" },
      { dateFormat: null },
      { dateFormat: "DMY" },
      { timeFormat: "H12", dateFormat: "MDY" },
      { timezone: "Bogota" },
    ];
    for (const change of changes) {
      expect(codeOf(await update({ user: ana, ...change }))).toBe("PreferenceLocked");
    }
    // The detail names the locked field the change touched, never the free one it sent beside it (P72).
    expect(await update({ user: ana, timeFormat: "H12", dateFormat: "MDY" })).toMatchObject({
      ok: false,
      error: { code: "PreferenceLocked", details: { fields: ["dateFormat"] } },
    });
    expect(writes).toEqual([]);
    const { locked, effective } = await preferencesOf();
    expect([locked, effective.dateFormat]).toEqual([["dateFormat", "timezone"], "DMY"]);
  });

  it("stores and clears the display currency, and refuses an unknown code (D29, slice MC4)", async () => {
    const { update, preferencesOf } = world();
    // Null by default: the person follows their personal space's currency.
    expect((await preferencesOf()).displayCurrency).toBe(null);
    unwrap(await update({ user: ana, displayCurrency: "USD" }));
    expect((await preferencesOf()).displayCurrency).toBe("USD");
    // An unknown code is refused and nothing changes.
    expect(codeOf(await update({ user: ana, displayCurrency: "XYZ" }))).toBe("UnknownCurrency");
    expect((await preferencesOf()).displayCurrency).toBe("USD");
    // Null clears it back to the personal space's currency.
    unwrap(await update({ user: ana, displayCurrency: null }));
    expect((await preferencesOf()).displayCurrency).toBe(null);
  });

  it("stores a display currency typed in lower case as its ISO 4217 code (D29, slice MC4)", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, displayCurrency: "usd" }));
    expect((await preferencesOf()).displayCurrency).toBe("USD");
  });

  it("has no favorite currencies until the person chooses some, so Ajustes shows their personal space's (P342)", async () => {
    expect((await world().preferencesOf()).favoriteCurrencies).toBe(null);
  });

  it("stores the favorite currencies in the person's order, as ISO 4217 codes (P342)", async () => {
    const { update, preferencesOf, writes } = world();
    unwrap(await update({ user: ana, favoriteCurrencies: ["COP", "usd", "EUR"] }));
    expect((await preferencesOf()).favoriteCurrencies).toEqual(["COP", "USD", "EUR"]);
    expect(writes).toEqual([["u-ana", { favoriteCurrencies: ["COP", "USD", "EUR"] }]]);
    // An empty list is a choice of its own: no favorites, not "never chose".
    unwrap(await update({ user: ana, favoriteCurrencies: [] }));
    expect((await preferencesOf()).favoriteCurrencies).toEqual([]);
  });

  it("drops a repeated favorite currency, keeping its first place (P342)", async () => {
    const { update, preferencesOf } = world();
    unwrap(await update({ user: ana, favoriteCurrencies: ["USD", "COP", "usd", "COP"] }));
    expect((await preferencesOf()).favoriteCurrencies).toEqual(["USD", "COP"]);
  });

  it("refuses an unknown favorite currency and writes nothing (P342)", async () => {
    const { update, preferencesOf, writes } = world();
    expect(await update({ user: ana, favoriteCurrencies: ["USD", "XYZ"], timeFormat: "H12" })).toEqual({
      ok: false,
      error: { code: "UnknownCurrency", details: { currency: "XYZ" } },
    });
    expect(writes).toEqual([]);
    expect((await preferencesOf()).favoriteCurrencies).toBe(null);
  });

  it("keeps at most 20 favorite currencies, each counted once (P342)", async () => {
    const { update, preferencesOf } = world();
    const twenty = ["COP", "USD", "EUR", "MXN", "BRL", "JPY", "GBP", "CAD", "AUD", "CHF"].concat([
      "CLP",
      "PEN",
      "ARS",
      "UYU",
      "CNY",
      "INR",
      "KRW",
      "SEK",
      "NOK",
      "DKK",
    ]);
    unwrap(await update({ user: ana, favoriteCurrencies: [...twenty, "usd"] }));
    expect((await preferencesOf()).favoriteCurrencies).toEqual(twenty);
    expect(codeOf(await update({ user: ana, favoriteCurrencies: [...twenty, "PLN"] }))).toBe(
      "TooManyFavoriteCurrencies",
    );
    expect((await preferencesOf()).favoriteCurrencies).toEqual(twenty);
  });

  it("keep the stored value under a lock and bring it back when the lock is lifted", async () => {
    const { update, lock, preferencesOf } = world();
    unwrap(await update({ user: ana, dateFormat: "MDY" }));
    lock(["dateFormat"]);
    const locked = await preferencesOf();
    expect([locked.stored.dateFormat, locked.effective.dateFormat]).toEqual(["MDY", "DMY"]);
    lock([]);
    const lifted = await preferencesOf();
    expect([lifted.stored.dateFormat, lifted.effective.dateFormat]).toEqual(["MDY", "MDY"]);
  });
});

describe("the @usuario on the profile (P339, P343)", () => {
  it("is always there, as stored", async () => {
    const { profileOf } = world();
    expect((await profileOf()).handle).toBe("ana_4821");
  });

  it("changes to a valid one, read in lower case and without the @", async () => {
    const { handleWrites, update, profileOf } = world();
    expect(codeOf(await update({ user: ana, handle: "@Ana_B" }))).toBe("ok");
    expect(handleWrites).toEqual([[ana.id, "ana_b"]]);
    expect((await profileOf()).handle).toBe("ana_b");
  });

  it("refuses to clear it with InvalidHandle, and writes nothing", async () => {
    const { writes, handleWrites, update, profileOf } = world();
    expect(codeOf(await update({ user: ana, handle: null, timezone: "Europe/Madrid" }))).toBe(
      "InvalidHandle",
    );
    expect(handleWrites).toEqual([]);
    expect(writes).toEqual([]);
    expect((await profileOf()).handle).toBe("ana_4821");
  });
});
