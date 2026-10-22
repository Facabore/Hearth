import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "./theme";
import { ThemeSync } from "./theme-sync";

describe("ThemeSync (N1: the page of a notFound() thrown in a layout still wears the theme)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sets the theme on mount when the head script did not", () => {
    render(<ThemeSync />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("honours a stored choice over the system", () => {
    localStorage.setItem(THEME_KEY, "light");
    render(<ThemeSync />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
