import { setSheetGate, SHEET_KEY, sheetDepth, sheetsEnabled } from "./sheet-gate";

/**
 * Ruling P307: a sheet without an address of its own takes one entry of the browser's history while it is open, so the
 * browser's Back (and Android's) closes the sheet instead of leaving the screen with what was typed in it. The entry
 * has the screen's own address; its state carries the sheet's depth (a sheet over a sheet is one deeper).
 *
 * Closing the sheet any other way (Escape, the scrim, ✕, saving) gives its entry back, so Back afterwards leaves the
 * screen in one step. A navigation started while a sheet's entry is current first returns to the screen's own entry
 * (`afterSheets` in `sheet-gate.ts`, which leads here once a sheet has loaded this module), so the new screen never
 * stacks on top of the sheet's entry. Only the single-page app turns this on (`enableSheetHistory`); a sheet that has
 * its own address (`?tx=`, `/accounts/new`) never takes an entry.
 */
export { sheetDepth };

/** The browser is going back past sheets' entries: the next close or navigation waits until it lands. */
let settling: Promise<void> | null = null;
/** The depths of the sheets on screen whose entry is theirs. */
const open = new Set<number>();

const traverse = (delta: number): Promise<void> => {
  const landed = new Promise<void>((resolve) =>
    window.addEventListener(
      "popstate",
      () => {
        settling = null;
        resolve();
      },
      { once: true },
    ),
  );
  settling = landed;
  window.history.go(delta);
  return landed;
};

/**
 * A sheet opened: its entry is added and its depth returned, or 0 when sheets take no entry. `kept` is the depth the
 * same sheet had before React mounted it again (StrictMode in development); it keeps that entry.
 */
export const openSheetEntry = (kept = 0): number => {
  if (!sheetsEnabled()) return 0;
  if (kept > 0 && sheetDepth() === kept && !open.has(kept)) {
    open.add(kept);
    return kept;
  }
  const depth = sheetDepth() + 1;
  window.history.pushState({ ...(window.history.state as object | null), [SHEET_KEY]: depth }, "");
  open.add(depth);
  return depth;
};

/** Goes back past the entries of sheets that closed (those above the topmost sheet still open), after any move under way. */
const trim = (): void => {
  if (settling) {
    void settling.then(trim);
    return;
  }
  const extra = sheetDepth() - Math.max(0, ...open);
  if (extra > 0) void traverse(-extra);
};

/**
 * A sheet closed. Unless Back already took its entry, a navigation is going back past it, or the sheet came back (a
 * remount in development), its entry goes, with those of the sheets that closed with it.
 */
export const closeSheetEntry = (depth: number): void => {
  if (depth === 0) return;
  open.delete(depth);
  queueMicrotask(trim);
};

/** A navigation from the screen's own entry: after any move under way, and below the sheets open over it. */
const passSheets = (navigate: () => void): void => {
  if (settling) {
    // The router hears the same event and settles on the landing entry first.
    void settling.then(() => setTimeout(() => passSheets(navigate), 0));
    return;
  }
  const depth = sheetDepth();
  if (depth === 0) navigate();
  else void traverse(-depth).then(() => setTimeout(navigate, 0));
};
setSheetGate(passSheets);
