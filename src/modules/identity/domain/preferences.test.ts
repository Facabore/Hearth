import { describe, expect, it } from "vitest";
import {
  BUILT_IN_RULES,
  NO_PREFERENCES,
  effectivePreferences,
  formatsIn,
  lockedFieldsIn,
  type InstallationRules,
} from "./preferences";

const lockingDates: InstallationRules = { ...BUILT_IN_RULES, locked: ["dateFormat"] };

describe("formatting preferences (HU-E1-15)", () => {
  it("builds in es-CO's formats and no lock until HU-E8-18 stores the rules", () => {
    expect(BUILT_IN_RULES).toEqual({
      defaults: { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" },
      locked: [],
    });
    expect(effectivePreferences(NO_PREFERENCES, BUILT_IN_RULES)).toEqual(BUILT_IN_RULES.defaults);
  });

  it("applies a stored value over the rule, field by field", () => {
    expect(effectivePreferences({ ...NO_PREFERENCES, timeFormat: "H12" }, BUILT_IN_RULES)).toEqual({
      ...BUILT_IN_RULES.defaults,
      timeFormat: "H12",
    });
  });

  it("applies the rule of a locked field, and the stored value again once the lock is lifted", () => {
    const stored = { ...NO_PREFERENCES, dateFormat: "MDY" as const };
    expect(effectivePreferences(stored, lockingDates).dateFormat).toBe("DMY");
    expect(effectivePreferences(stored, BUILT_IN_RULES).dateFormat).toBe("MDY");
  });

  it("names the locked fields a change touches, even to clear them or to repeat their value", () => {
    const rules: InstallationRules = { ...BUILT_IN_RULES, locked: ["dateFormat", "timezone"] };
    expect(lockedFieldsIn({ dateFormat: "MDY", timeFormat: "H12" }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ dateFormat: null }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ dateFormat: "DMY" }, rules)).toEqual(["dateFormat"]);
    expect(lockedFieldsIn({ locale: "en", timezone: "Europe/Madrid" }, rules)).toEqual(["timezone"]);
    expect(lockedFieldsIn({ timeFormat: "H12" }, rules)).toEqual([]);
  });

  it("keeps only the formats a change sets or clears", () => {
    expect(formatsIn({ timezone: "UTC", locale: "en", timeFormat: null, weekStart: "SUNDAY" })).toEqual({
      timeFormat: null,
      weekStart: "SUNDAY",
    });
  });
});
