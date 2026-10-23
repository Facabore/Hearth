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
 */
export const ownSuggestion = (
  suggestion: CapacitySuggestionDto | null,
  own: Pick<SpaceMemberDto, "id"> | null,
): CapacitySuggestionDto | null =>
  suggestion !== null && own !== null && suggestion.suggested !== null && suggestion.memberId === own.id
    ? suggestion
    : null;
