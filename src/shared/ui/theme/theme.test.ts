// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyStoredTheme, readTheme, resolveTheme, saveTheme, THEME_BOOTSTRAP, THEME_KEY } from "./theme";

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

  describe("applyStoredTheme (a page whose head script never ran)", () => {
    const prefers = (dark: boolean) =>
      vi.stubGlobal("matchMedia", () => ({
        matches: dark,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    afterEach(() => vi.unstubAllGlobals());

    it("applies the stored choice, whatever the system prefers", () => {
      prefers(false);
      localStorage.setItem(THEME_KEY, "dark");
      applyStoredTheme();
      expect(document.documentElement.dataset.theme).toBe("dark");
      prefers(true);
      localStorage.setItem(THEME_KEY, "light");
      applyStoredTheme();
      expect(document.documentElement.dataset.theme).toBe("light");
    });

    it("follows the system when nothing is stored or the choice is Sistema", () => {
      prefers(true);
      applyStoredTheme();
      expect(document.documentElement.dataset.theme).toBe("dark");
      prefers(false);
      localStorage.setItem(THEME_KEY, "system");
      applyStoredTheme();
      expect(document.documentElement.dataset.theme).toBe("light");
    });
  });
});
