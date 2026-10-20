import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { BUILT_IN_RULES, type InstallationRules } from "@/modules/identity/application";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

// HU-E1-15 Background: the built-in rules (DOT_COMMA, H24, DMY, MONDAY); the locked scenario swaps them for its run.
let rules: InstallationRules = BUILT_IN_RULES;
let app: Container;
beforeAll(() => {
  app = startTestApp({ installationRules: { rules: async () => rules } });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Formats {
  numberFormat: string;
  timeFormat: string;
  dateFormat: string;
  weekStart: string;
}
interface Me {
  locale: string;
  timezone: string;
  preferences: {
    stored: Record<keyof Formats, string | null>;
    effective: Formats;
    defaults: Formats & { timezone: string; locale: string };
    locked: string[];
  };
}
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const NONE = { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null };
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;
const patch = (user: TestUser, body: Record<string, unknown>) =>
  call(patchMe, "PATCH", "/api/v1/me", { user, body });

describe("formatting preferences (HU-E1-15)", () => {
  it("follow the installation rules without an override, with nothing locked", async () => {
    const ana = await registerUser("Ana");
    const { locale, preferences } = await me(ana);
    expect(locale).toBe("es");
    expect(preferences).toEqual({
      stored: NONE,
      effective: RULES,
      defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },
      locked: [],
    });
  });

  it("let one person override the time format while the others keep the rule", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const changed = await patch(ana, { timeFormat: "H12" });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as Me).preferences.effective.timeFormat).toBe("H12");
    const { stored, effective } = (await me(ana)).preferences;
    expect([stored, effective]).toEqual([
      { ...NONE, timeFormat: "H12" },
      { ...RULES, timeFormat: "H12" },
    ]);
    expect((await me(juan)).preferences.effective.timeFormat).toBe("H24");
  });

  it("stay as they are when the language changes", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { numberFormat: "COMMA_DOT", timeFormat: "H12" })).status).toBe(200);
    const english = (await (await patch(ana, { locale: "en" })).json()) as Me;
    expect([english.locale, english.preferences.effective]).toEqual([
      "en",
      { ...RULES, numberFormat: "COMMA_DOT", timeFormat: "H12" },
    ]);
    expect((await me(ana)).locale).toBe("en");
  });

  it("keep the installation's zone and language as defaults when the person changes their own", async () => {
    const ana = await registerUser("Ana");
    const changed = (await (await patch(ana, { locale: "en", timezone: "Europe/Madrid" })).json()) as Me;
    expect([changed.locale, changed.timezone]).toEqual(["en", "Europe/Madrid"]);
    const { defaults } = (await me(ana)).preferences;
    expect(defaults).toEqual({ ...RULES, timezone: "America/Bogota", locale: "es" });
  });

  it("return to the rule when set to null", async () => {
    const ana = await registerUser("Ana");
    expect((await patch(ana, { timeFormat: "H12" })).status).toBe(200);
    expect((await me(ana)).preferences.stored.timeFormat).toBe("H12");
    expect((await patch(ana, { timeFormat: null })).status).toBe(200);
    const { stored, effective } = (await me(ana)).preferences;
    expect([stored.timeFormat, effective.timeFormat]).toEqual([null, "H24"]);
  });

  it("refuse a locked preference with 409 PreferenceLocked and show the lock", async () => {
    const ana = await registerUser("Ana");
    rules = { ...BUILT_IN_RULES, locked: ["dateFormat"] };
    try {
      expect(await problemOf(await patch(ana, { dateFormat: "MDY" }))).toEqual([409, "PreferenceLocked"]);
      const { locked, effective } = (await me(ana)).preferences;
      expect([locked, effective.dateFormat]).toEqual([["dateFormat"], "DMY"]);
      // A change that also names a free field is refused whole, and its problem does not name the locked field.
      const mixed = await patch(ana, { timeFormat: "H12", dateFormat: "MDY" });
      const problem = (await mixed.json()) as Record<string, unknown>;
      expect([mixed.status, problem.code]).toEqual([409, "PreferenceLocked"]);
      expect(problem).not.toHaveProperty("fields");
      expect(problem).not.toHaveProperty("details");
      expect((await me(ana)).preferences.stored).toEqual(NONE);
    } finally {
      rules = BUILT_IN_RULES;
    }
  });

  it("refuse an unknown value with 422 ValidationFailed and keep what is stored", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await patch(ana, { numberFormat: "DOT_DOT" }))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await patch(ana, { locale: "fr" }))).toEqual([422, "ValidationFailed"]);
    const after = await me(ana);
    expect([after.locale, after.preferences.stored]).toEqual(["es", NONE]);
  });
});
