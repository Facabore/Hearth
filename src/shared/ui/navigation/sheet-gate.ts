/**
 * Ruling P307: the part of the sheets' history (`sheet-history.ts`) that the app's first script holds. The rest loads
 * with the first sheet, which is the first time the history holds a sheet's entry, and puts itself in `afterSheets`.
 */
export const SHEET_KEY = "hearthSheet";

let enabled = false;
let gate: ((navigate: () => void) => void) | undefined;

export const sheetsEnabled = (): boolean => enabled;

/** How many sheets the current entry of the browser's history has open: 0 on a screen's own entry. */
export const sheetDepth = (state: unknown = window.history.state): number => {
  const depth = (state as Record<string, unknown> | null)?.[SHEET_KEY];
  return typeof depth === "number" && depth > 0 ? depth : 0;
};

/** Turned on once at start. A reload on a sheet's entry opens no sheet, so that entry counts as the screen's own. */
export const enableSheetHistory = (): void => {
  enabled = true;
  if (sheetDepth() > 0) {
    const state = { ...(window.history.state as Record<string, unknown>) };
    delete state[SHEET_KEY];
    window.history.replaceState(state, "");
  }
};

export const setSheetGate = (next: (navigate: () => void) => void): void => {
  gate = next;
};

/** Runs `navigate` from the screen's own entry, below any sheet open over it (`sheet-history.ts`). */
export const afterSheets = (navigate: () => void): void => (gate ? gate(navigate) : navigate());
