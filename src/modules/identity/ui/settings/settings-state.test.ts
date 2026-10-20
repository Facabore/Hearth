import { describe, expect, it } from "vitest";
import { meDto } from "../../../../../tests/support/ui/dto";
import { choose, reset, rowState } from "./settings-state";

const preferences = meDto().preferences;

describe("settings state (HU-E9-13, ruling P137)", () => {
  it("stores a choice that differs from the rule, and clears one equal to it", () => {
    const comma = choose(preferences, "numberFormat", "COMMA_DOT");
    expect(comma.patch).toEqual({ numberFormat: "COMMA_DOT" });
    expect(comma.next.effective.numberFormat).toBe("COMMA_DOT");
    expect(rowState(comma.next, "numberFormat")).toBe("custom");
    const back = choose(comma.next, "numberFormat", "DOT_COMMA");
    expect(back.patch).toEqual({ numberFormat: null });
    expect(rowState(back.next, "numberFormat")).toBe("default");
  });

  it("resets a changed field to the rule", () => {
    const twelve = choose(preferences, "timeFormat", "H12").next;
    const { next, patch } = reset(twelve, "timeFormat");
    expect(patch).toEqual({ timeFormat: null });
    expect([next.stored.timeFormat, next.effective.timeFormat, rowState(next, "timeFormat")]).toEqual([
      null,
      "H24",
      "default",
    ]);
  });

  it("marks a field the installation locks, whatever is stored", () => {
    const locked = {
      ...preferences,
      stored: { ...preferences.stored, dateFormat: "MDY" as const },
      locked: ["dateFormat" as const],
    };
    expect(rowState(locked, "dateFormat")).toBe("locked");
    expect(rowState(locked, "timeFormat")).toBe("default");
  });

  it("keeps the rule's value as the effective one while a field is locked, whatever a change stores", () => {
    const locked = { ...preferences, locked: ["dateFormat" as const] };
    const { next } = choose(locked, "dateFormat", "MDY");
    expect([next.stored.dateFormat, next.effective.dateFormat]).toEqual(["MDY", "DMY"]);
  });
});
