import type { BudgetPlanDto, CapacitySuggestionDto, MoneyDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

/** HU-E6-02: each member's capacity as the field starts it: the stored amount in the person's format, or empty. */
export const draftsOf = (
  plan: BudgetPlanDto,
  members: readonly SpaceMemberDto[],
  formats: Pick<Formats, "numberFormat">,
): Record<string, string> =>
  Object.fromEntries(
    members.map((member) => {
      const stored = plan.capacities.find((c) => c.memberId === member.id);
      const exponent = currencyOf(plan.totalCapacity.currency).exponent;
      return [member.id, stored ? formatNumber(decimalOf(stored.amount.amount, exponent), formats) : ""];
    }),
  );

/** The PUT body: only the rows the viewer may change (D17), an empty field as 0; the first unreadable row fails. */
export const capacityBodyOf = (
  drafts: Readonly<Record<string, string>>,
  editableIds: readonly string[],
  currency: string,
  numberFormat: NumberFormat,
):
  | { ok: true; body: { capacities: { memberId: string; amount: MoneyDto }[] } }
  | { ok: false; memberId: string } => {
  const capacities: { memberId: string; amount: MoneyDto }[] = [];
  for (const memberId of editableIds) {
    const text = (drafts[memberId] ?? "").trim();
    const decimal = text === "" ? "0" : parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
    if (minor === null) return { ok: false, memberId };
    capacities.push({ memberId, amount: { amount: minor, currency } });
  }
  return { ok: true, body: { capacities } };
};

/** Ruling P118: a `capacities.<i>` path names the i-th row sent; any other problem belongs to the form. */
export const capacityFieldOf = (problem: Problem, sentIds: readonly string[]): string => {
  const index = /^capacities\.(\d+)/.exec(problem.errors[0]?.path ?? "")?.[1];
  return index === undefined ? "form" : (sentIds[Number(index)] ?? "form");
};

/**
 * Ruling P208, D17: the suggestion is private to its member. Only one that names the viewer's own member, and
 * carries an amount, goes on to the screen; anything else is dropped here, so it never reaches the page's payload.
 * Issue #175: an amount of 0 (no income last period) suggests nothing, so it is dropped too.
 */
export const ownSuggestion = (
  suggestion: CapacitySuggestionDto | null,
  own: Pick<SpaceMemberDto, "id"> | null,
): CapacitySuggestionDto | null =>
  suggestion !== null &&
  own !== null &&
  suggestion.suggested !== null &&
  BigInt(suggestion.suggested.amount) !== 0n &&
  suggestion.memberId === own.id
    ? suggestion
    : null;

/** Ruling P342 (S7): one contribution in another currency than the plan's space, as its field holds it. */
export interface OtherDraft {
  readonly currency: string;
  readonly text: string;
}

/** The field key of a contribution in another currency, which a failure names. */
export const otherKey = (memberId: string, currency: string) => `${memberId}:${currency}`;

/**
 * Ruling P342 (S7, "Juan 2.400.000 COP y 100 USD"): each member's stored contributions in the plan's other
 * currencies, as their fields start, in the plan's order of currencies; a zero one has no field.
 */
export const otherDraftsOf = (
  plan: BudgetPlanDto,
  members: readonly SpaceMemberDto[],
  formats: Pick<Formats, "numberFormat">,
): Record<string, OtherDraft[]> =>
  Object.fromEntries(
    members.map((member) => [
      member.id,
      (plan.currencies ?? []).slice(1).flatMap(({ capacities }) =>
        capacities
          .filter((c) => c.memberId === member.id && BigInt(c.amount.amount) !== 0n)
          .map((c) => ({
            currency: c.amount.currency,
            text: formatNumber(decimalOf(c.amount.amount, currencyOf(c.amount.currency).exponent), formats),
          })),
      ),
    ]),
  );

/**
 * The PUT rows for the other currencies of the rows the viewer may change: each field (empty as 0), then 0 for a
 * stored contribution whose field was removed, which clears it. The first unreadable field fails with its key.
 */
export const otherCapacitiesOf = (
  drafts: Readonly<Record<string, readonly OtherDraft[]>>,
  stored: Readonly<Record<string, readonly OtherDraft[]>>,
  editableIds: readonly string[],
  numberFormat: NumberFormat,
): { ok: true; rows: { memberId: string; amount: MoneyDto }[] } | { ok: false; key: string } => {
  const rows: { memberId: string; amount: MoneyDto }[] = [];
  for (const memberId of editableIds) {
    const fields = drafts[memberId] ?? [];
    for (const { currency, text } of fields) {
      const decimal = text.trim() === "" ? "0" : parseDecimal(text.trim(), numberFormat);
      const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
      if (minor === null) return { ok: false, key: otherKey(memberId, currency) };
      rows.push({ memberId, amount: { amount: minor, currency } });
    }
    for (const { currency } of stored[memberId] ?? [])
      if (!fields.some((field) => field.currency === currency))
        rows.push({ memberId, amount: { amount: "0", currency } });
  }
  return { ok: true, rows };
};
