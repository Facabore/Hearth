import type { Person, Place } from "../direct/counterparts";

/** P334: Transferencia between the recorder's own accounts, to someone, or from someone. */
export type TransferMode = "OWN" | "TO" | "FROM";

export interface PersonTransfer {
  readonly mode: TransferMode;
  /** The person, by their `Person.memberId`; null until one is chosen. */
  readonly personId: string | null;
  /** The chosen place among the person's (their direct space first). */
  readonly placeIndex: number;
}

export const placeOf = (person: Person | undefined, transfer: PersonTransfer): Place | undefined =>
  person?.places[transfer.placeIndex] ?? person?.places[0];

/**
 * P334: the request that records the transfer as a settlement (P322) between the recorder and the person: in a space
 * they share, `POST …/settlements` with both member ids; in their direct space while it does not exist,
 * `POST /api/v1/direct-settlements`, which creates it (D16). The recorder's account is the source of what they gave
 * (TO) or where what they got went (FROM); the other side has none.
 */
export const personTransferRequest = (
  transfer: PersonTransfer,
  person: Person,
  base: Record<string, unknown> & { readonly accountId: unknown },
):
  | { readonly path: "direct"; readonly body: Record<string, unknown> }
  | { readonly path: "space"; readonly spaceId: string; readonly body: Record<string, unknown> } => {
  const { accountId, ...fields } = base;
  const place = placeOf(person, transfer);
  if (!place || place.spaceId === null || place.theirMemberId === null || place.myMemberId === null)
    return {
      path: "direct",
      body: {
        ...fields,
        accountId,
        direction: transfer.mode,
        // A registered co-member of a group: the API finds or creates the pair's direct space (D16).
        counterpart: { kind: "MEMBER", memberId: person.memberId },
      },
    };
  const to = transfer.mode === "TO";
  return {
    path: "space",
    spaceId: place.spaceId,
    body: {
      ...fields,
      payerMemberId: to ? place.myMemberId : place.theirMemberId,
      receivingMemberId: to ? place.theirMemberId : place.myMemberId,
      ...(to ? { sourceAccountId: accountId } : { destinationAccountId: accountId }),
    },
  };
};

/**
 * What the recorder owes the person in that space, in minor units, from its pair-by-pair suggestions (P323): positive
 * when the recorder owes, negative when the person owes the recorder, zero when neither owes the other.
 */
export const debtWith = (
  suggestions: readonly {
    readonly payerMemberId: string;
    readonly receivingMemberId: string;
    readonly amount: { readonly amount: string };
  }[],
  me: string,
  them: string,
): bigint =>
  suggestions.reduce((owed, s) => {
    if (s.payerMemberId === me && s.receivingMemberId === them) return owed + BigInt(s.amount.amount);
    if (s.payerMemberId === them && s.receivingMemberId === me) return owed - BigInt(s.amount.amount);
    return owed;
  }, 0n);

export type TransferEffect =
  | { readonly key: "partial"; readonly amount: bigint; readonly rest: bigint }
  | { readonly key: "settle" }
  | { readonly key: "over"; readonly debt: bigint; readonly rest: bigint }
  | { readonly key: "owes"; readonly total: bigint }
  | { readonly key: "theirPartial"; readonly amount: bigint; readonly rest: bigint }
  | { readonly key: "theirSettle" }
  | { readonly key: "theirOver"; readonly debt: bigint; readonly rest: bigint }
  | { readonly key: "youOwe"; readonly total: bigint };

/**
 * P334: the transfer's effect on what the two owe each other in that one space, never across spaces: "Saldas tu deuda
 * de $ 100.000 y Juan queda debiéndote $ 50.000", "Juan queda debiéndote $ 150.000", "Saldas tu deuda con Juan".
 */
export const effectOf = (mode: "TO" | "FROM", owed: bigint, amount: bigint): TransferEffect => {
  if (mode === "TO") {
    if (owed <= 0n) return { key: "owes", total: amount - owed };
    if (amount < owed) return { key: "partial", amount, rest: owed - amount };
    return amount === owed ? { key: "settle" } : { key: "over", debt: owed, rest: amount - owed };
  }
  const theirs = -owed;
  if (theirs <= 0n) return { key: "youOwe", total: amount + owed };
  if (amount < theirs) return { key: "theirPartial", amount, rest: theirs - amount };
  return amount === theirs
    ? { key: "theirSettle" }
    : { key: "theirOver", debt: theirs, rest: amount - theirs };
};
