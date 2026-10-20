// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readTheme, resolveTheme, saveTheme, THEME_BOOTSTRAP, THEME_KEY } from "./theme";

describe("theme (HU-E9-13, ruling P135)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("follows the system unless the person chose light or dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads anything unknown or unreadable as system", () => {
    expect(readTheme({ getItem: () => "sepia" })).toBe("system");
    expect(
      readTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("system");
    expect(readTheme(undefined)).toBe("system");
  });

  it("applies a saved choice before paint and on change", () => {
    saveTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    delete document.documentElement.dataset.theme;
    new Function(THEME_BOOTSTRAP)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
