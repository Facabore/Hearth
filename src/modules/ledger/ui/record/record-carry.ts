import type { RecordKind } from "./record-request";
import type { When } from "./when-label";

/** Ruling P305: what a form hands the form of another space: what was typed, never what depends on the space. */
export interface RecordCarry {
  readonly kind: RecordKind;
  readonly amount: string;
  readonly description: string;
  readonly when: When | null;
  /**
   * Ruling P321: the account chosen in Desde, handed over only when the form comes back to the same space (Crear un
   * fondo). The form restores it only while it is still one it offers, so another space's account never is.
   */
  readonly accountId?: string;
  /**
   * P348: the accounts the form offered when the person left it for Nueva cuenta. Back on the form, the one account it
   * offers that is not among them is the one just created, and it is chosen.
   */
  readonly offeredAccountIds?: readonly string[];
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

/** P348: the one account `offered` now that the form did not offer when it left for Nueva cuenta, or null. */
export const newAccountOf = (
  carry: RecordCarry | null | undefined,
  offered: readonly { readonly id: string }[],
): string | null => {
  const before = carry?.offeredAccountIds;
  if (!before) return null;
  const added = offered.filter((a) => !before.includes(a.id));
  return added.length === 1 ? added[0]!.id : null;
};
