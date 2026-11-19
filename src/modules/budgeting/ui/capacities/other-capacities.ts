import type { MoneyDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import type { OtherDraft } from "./capacity-draft";

/**
 * The PUT rows for the other currencies of the rows the viewer may change: each field (empty as 0), then 0 for a
 * stored contribution whose field was removed, which clears it. The first unreadable field fails with its member and currency.
 */
export const otherCapacitiesOf = (
  drafts: Readonly<Record<string, readonly OtherDraft[]>>,
  stored: Readonly<Record<string, readonly OtherDraft[]>>,
  editableIds: readonly string[],
  numberFormat: NumberFormat,
):
  | { ok: true; rows: { memberId: string; amount: MoneyDto }[] }
  | { ok: false; memberId: string; currency: string } => {
  const rows: { memberId: string; amount: MoneyDto }[] = [];
  for (const memberId of editableIds) {
    const fields = drafts[memberId] ?? [];
    for (const { currency, text } of fields) {
      const decimal = text.trim() === "" ? "0" : parseDecimal(text.trim(), numberFormat);
      const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
      if (minor === null) return { ok: false, memberId, currency };
      rows.push({ memberId, amount: { amount: minor, currency } });
    }
    for (const { currency } of stored[memberId] ?? [])
      if (!fields.some((field) => field.currency === currency))
        rows.push({ memberId, amount: { amount: "0", currency } });
  }
  return { ok: true, rows };
};
