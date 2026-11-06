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
 * Ruling P305: held in memory for the space it was handed to, until the next record form is on screen. It never travels
 * in the address: an amount is nobody else's business.
 */
let held: { readonly spaceId: string; readonly carry: RecordCarry } | null = null;

export const handOver = (spaceId: string, carry: RecordCarry): void => {
  held = { spaceId, carry };
};

/** What was handed to `spaceId`, read as often as a render needs it. */
export const heldFor = (spaceId: string): RecordCarry | null =>
  held?.spaceId === spaceId ? held.carry : null;

/**
 * Any record form on screen ends what was held: the one it was handed to has made it its own, and any other means the
 * move never arrived, so a later visit starts empty instead of with an old draft.
 */
export const release = (): void => {
  held = null;
};
