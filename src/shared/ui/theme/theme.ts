export const THEME_KEY = "hearth.theme";
export type Theme = "system" | "light" | "dark";
const THEMES: readonly Theme[] = ["system", "light", "dark"];

/** HU-E9-13, ruling P135: the theme is a device setting, outside the profile and the installation rules. */
export const resolveTheme = (theme: Theme, prefersDark: boolean): "light" | "dark" =>
  theme === "system" ? (prefersDark ? "dark" : "light") : theme;

export const readTheme = (storage: Pick<Storage, "getItem"> | undefined): Theme => {
  try {
    const value = storage?.getItem(THEME_KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : "system";
  } catch {
    return "system";
  }
};

const prefersDark = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export const saveTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A private window may refuse storage: the choice still applies to this page.
  }
  document.documentElement.dataset.theme = resolveTheme(theme, prefersDark());
};

/**
 * Sets `data-theme` from the stored choice and the system preference. The head script does this before the first paint;
 * this is for the pages whose head script never runs: a page Next renders on the client after a `notFound()` thrown in
 * a layout (`<html id="__next_error__">`) streams its head in, and a streamed script does not execute.
 */
export const applyStoredTheme = (): void => {
  let stored: Theme = "system";
  try {
    stored = readTheme(globalThis.localStorage);
  } catch {
    // Storage refused: the system preference decides.
  }
  document.documentElement.dataset.theme = resolveTheme(stored, prefersDark());
};

/** Runs in <head> before the first paint, so a dark choice never flashes light (and nothing shifts, CLS). */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=t==="dark"||((t!=="light")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;
