import type { RecordKind } from "./record-request";
import type { When } from "./when-label";

/** Ruling P305: what a form hands the form of another space: what was typed, never what depends on the space. */
export interface RecordCarry {
  readonly kind: RecordKind;
  readonly amount: string;
  readonly description: string;
  readonly when: When | null;
}

/**
 * Ruling P305: held in memory for the space it was handed to, until that space's form is on screen. It never travels in
 * the address: an amount is nobody else's business.
 */
let held: { readonly spaceId: string; readonly carry: RecordCarry } | null = null;

export const handOver = (spaceId: string, carry: RecordCarry): void => {
  held = { spaceId, carry };
};

/** What was handed to `spaceId`, read as often as a render needs it. */
export const heldFor = (spaceId: string): RecordCarry | null =>
  held?.spaceId === spaceId ? held.carry : null;

/** Once the form is on screen what was handed to it is its own; a later visit starts empty. */
export const release = (spaceId: string): void => {
  if (held?.spaceId === spaceId) held = null;
};
