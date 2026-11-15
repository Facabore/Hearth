import type { NumberFormat } from "@/shared/ui/format/formatters";
import { previewSplit, type ShareMethod } from "../split/split-math";
import { participantsOf, type ShareDraft } from "../split/split-request";
import type { Person } from "./counterparts";

/** The recorder's id in a personal expense's "Para quién fue" (P331): not a member id, since nobody else is in it. */
export const ME = "me";

/** Someone without Hearth the recorder typed in the sheet: a guest once the expense is saved (D15). */
export interface NewGuest {
  readonly id: string;
  readonly name: string;
}

/** P331, P333: who paid a personal expense, whom it was for, and how it is split. */
export interface PersonalForWhom {
  /** ME, or (P333) the person who paid with their own money: one of the people or a new guest. */
  readonly payer: string;
  readonly draft: ShareDraft;
  readonly guests: readonly NewGuest[];
}

export const initialForWhom = (): PersonalForWhom => ({
  payer: ME,
  draft: { method: "EQUAL", selected: [ME], values: {}, chosen: false },
  guests: [],
});

/**
 * P333: someone else paying makes the expense theirs and the recorder's only (a debt between two other people is not
 * the recorder's to record), so both are ticked; the recorder paying keeps whom it was for.
 */
export const withPayer = (forWhom: PersonalForWhom, payer: string): PersonalForWhom =>
  payer === ME
    ? { ...forWhom, payer }
    : { ...forWhom, payer, draft: { ...forWhom.draft, chosen: true, selected: [ME, payer] } };

const shareCheck = (
  forWhom: PersonalForWhom,
  input: {
    readonly people: readonly Person[];
    readonly amount: string;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
  },
) =>
  previewSplit({
    method: forWhom.draft.method as ShareMethod,
    amount: input.amount,
    currency: input.currency,
    numberFormat: input.numberFormat,
    participants: participantsOf(forWhom.draft, forWhomOrder(input.people, forWhom.guests)),
  });

/** P333: the recorder's part in minor units, or null while it cannot be told. */
export const myShareOf = (
  forWhom: PersonalForWhom,
  input: {
    readonly people: readonly Person[];
    readonly amount: string | null;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
  },
): string | null => {
  if (input.amount === null || forWhom.draft.method === "BY_ALLOCATION") return null;
  const check = shareCheck(forWhom, { ...input, amount: input.amount });
  return check.ok ? (check.shares.find((share) => share.memberId === ME)?.amount ?? null) : null;
};

/** The order the split rounds in: the recorder first, then the people, then the new guests. */
export const forWhomOrder = (people: readonly Person[], guests: readonly NewGuest[]): string[] => [
  ME,
  ...people.map((p) => p.memberId),
  ...guests.map((g) => g.id),
];

/** The ticked people other than the recorder, in order. */
export const othersTicked = (
  forWhom: PersonalForWhom,
  people: readonly Person[],
): { readonly id: string; readonly name: string }[] =>
  forWhomOrder(people, forWhom.guests)
    .filter((id) => id !== ME && forWhom.draft.selected.includes(id))
    .map((id) => ({
      id,
      name:
        people.find((p) => p.memberId === id)?.name ?? forWhom.guests.find((g) => g.id === id)?.name ?? "",
    }));

type MoneyDto = { readonly amount: string; readonly currency: string };
type Counterpart =
  | { readonly kind: "MEMBER"; readonly memberId: string }
  | { readonly kind: "GUEST"; readonly displayName: string };

/**
 * What a personal expense records (P331): only the recorder's own (`OWN`, an expense of the personal space), a split
 * through the direct spaces (`DIRECT`, `POST /api/v1/direct-splits`), or nothing yet while the parts do not add up.
 * Tú and one person in equal parts sends no `parts`, so the direct space's default split applies as before (HU-E1-13).
 */
export const personalRequestOf = (
  forWhom: PersonalForWhom,
  input: {
    readonly people: readonly Person[];
    /** Minor units of the amount, or null while there is none. */
    readonly amount: string | null;
    readonly currency: string;
    readonly numberFormat: NumberFormat;
  },
):
  | { readonly kind: "OWN" }
  | { readonly kind: "INVALID" }
  | {
      readonly kind: "DIRECT";
      readonly counterpart: Counterpart;
      /** P333: the counterpart paid, with their own money. */
      readonly paidBy?: "COUNTERPART";
      readonly parts?: {
        readonly mine: MoneyDto;
        readonly theirs: MoneyDto;
        readonly others?: readonly { readonly counterpart: Counterpart; readonly amount: MoneyDto }[];
      };
    } => {
  const counterpartOf = (id: string): Counterpart => {
    const guest = forWhom.guests.find((g) => g.id === id);
    return guest ? { kind: "GUEST", displayName: guest.name } : { kind: "MEMBER", memberId: id };
  };
  const { draft } = forWhom;
  // P333: someone else paid: one expense in their direct space, of which the recorder owes their own part.
  if (forWhom.payer !== ME) {
    const counterpart = counterpartOf(forWhom.payer);
    if (!draft.selected.includes(ME)) return { kind: "INVALID" };
    if (draft.method === "EQUAL" && draft.selected.includes(forWhom.payer))
      return { kind: "DIRECT", counterpart, paidBy: "COUNTERPART" };
    if (input.amount === null || draft.method === "BY_ALLOCATION") return { kind: "INVALID" };
    const check = shareCheck(forWhom, { ...input, amount: input.amount });
    if (!check.ok) return { kind: "INVALID" };
    const part = (id: string): MoneyDto => ({
      amount: check.shares.find((s) => s.memberId === id)?.amount ?? "0",
      currency: input.currency,
    });
    return {
      kind: "DIRECT",
      counterpart,
      paidBy: "COUNTERPART",
      parts: { mine: part(ME), theirs: part(forWhom.payer) },
    };
  }
  const others = othersTicked(forWhom, input.people);
  if (others.length === 0) return { kind: "OWN" };
  const [first, ...rest] = others;
  if (draft.method === "EQUAL" && others.length === 1 && draft.selected.includes(ME))
    return { kind: "DIRECT", counterpart: counterpartOf(first!.id) };
  if (input.amount === null || draft.method === "BY_ALLOCATION") return { kind: "INVALID" };
  const check = shareCheck(forWhom, { ...input, amount: input.amount });
  if (!check.ok) return { kind: "INVALID" };
  const money = (id: string): MoneyDto => ({
    amount: check.shares.find((s) => s.memberId === id)?.amount ?? "0",
    currency: input.currency,
  });
  return {
    kind: "DIRECT",
    counterpart: counterpartOf(first!.id),
    parts: {
      mine: money(ME),
      theirs: money(first!.id),
      ...(rest.length > 0
        ? { others: rest.map((other) => ({ counterpart: counterpartOf(other.id), amount: money(other.id) })) }
        : {}),
    },
  };
};
