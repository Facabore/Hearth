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

/** Runs in <head> before the first paint, so a dark choice never flashes light (and nothing shifts, CLS). */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});var d=t==="dark"||((t!=="light")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;
