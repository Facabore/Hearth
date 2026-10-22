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

describe("ThemeSync follows the system while the theme is Sistema (U9)", () => {
  type Listener = () => void;
  let dark = false;
  const listeners = new Set<Listener>();
  const removeEventListener = vi.fn((_type: string, listener: Listener) => listeners.delete(listener));
  /** The OS changes its preference: the media query now answers differently and tells its listeners. */
  const system = (next: boolean) => {
    dark = next;
    for (const listener of [...listeners]) listener();
  };

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    dark = false;
    listeners.clear();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return dark;
      },
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("switches without a reload when the system changes and no choice is stored", () => {
    render(<ThemeSync />);
    expect(document.documentElement.dataset.theme).toBe("light");
    system(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    system(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the system when the stored choice is Sistema, and ignores it for Claro and Oscuro", () => {
    localStorage.setItem(THEME_KEY, "system");
    const { unmount } = render(<ThemeSync />);
    system(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    unmount();
    localStorage.setItem(THEME_KEY, "light");
    render(<ThemeSync />);
    system(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    system(false);
    localStorage.setItem(THEME_KEY, "dark");
    system(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<ThemeSync />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
