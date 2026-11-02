import { useSyncExternalStore } from "react";

/**
 * The id of the header's slot for a screen's own control (Inicio's eye, board B1 · 03): the screen portals it there.
 * The shell writes it out, so it carries none of the eye's code.
 */
export const HEADER_SLOT_ID = "shell-actions";

/** What an amount shows while the person hides them (ruling P277). */
export const MASKED_AMOUNT = "••••••";

const keyOf = (personId: string) => `hearth.hideAmounts.${personId}`;
const listeners = new Set<() => void>();
/** This visit's choice per person, so a blocked or full storage still keeps it until the next visit. */
const chosen = new Map<string, boolean>();

const stored = (personId: string): boolean => {
  try {
    return globalThis.localStorage.getItem(keyOf(personId)) === "1";
  } catch {
    return false;
  }
};

/** Inicio's eye (B1 · 03, ruling P277): hides or shows the person's amounts, remembered by this browser per person. */
export const setAmountsHidden = (personId: string, hidden: boolean): void => {
  chosen.set(personId, hidden);
  try {
    if (hidden) globalThis.localStorage.setItem(keyOf(personId), "1");
    else globalThis.localStorage.removeItem(keyOf(personId));
  } catch {
    // Nothing to do: this visit keeps the choice.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the person hides her amounts; Inicio and the space switcher follow it. */
export const useAmountsHidden = (personId: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => chosen.get(personId) ?? stored(personId),
    () => false,
  );
