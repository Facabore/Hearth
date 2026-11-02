import type { MoneyDto, TransactionDto } from "@/shared/ui/api/dto";
import { relativeDay } from "@/shared/ui/time/when";

export interface DayGroup {
  readonly date: string;
  readonly relative: "today" | "yesterday" | null;
  readonly items: TransactionDto[];
}

/** Ruling P130: consecutive rows of one date, in the API's order (newest day first, untimed rows last, P43). */
export const groupByDay = (items: readonly TransactionDto[], today: string): DayGroup[] => {
  const groups: DayGroup[] = [];
  for (const tx of items) {
    const last = groups.at(-1);
    if (last && last.date === tx.date) last.items.push(tx);
    else {
      const relative = relativeDay(tx.date, today);
      groups.push({
        date: tx.date,
        relative: relative === "today" || relative === "yesterday" ? relative : null,
        items: [tx],
      });
    }
  }
  return groups;
};

/**
 * Ruling P277 (board B1 06): a day's income less its spending, in the API's minor units as bigint so no amount ever
 * rounds; transfers and payments between members move money without spending it. None for a day with neither.
 */
export const dayNet = (items: readonly TransactionDto[]): MoneyDto | null => {
  let net = 0n;
  let currency: string | null = null;
  for (const tx of items) {
    if (tx.type !== "EXPENSE" && tx.type !== "INCOME") continue;
    const amount = BigInt(tx.amount.amount);
    net += tx.type === "INCOME" ? amount : -amount;
    currency = tx.amount.currency;
  }
  return currency === null ? null : { amount: net.toString(), currency };
};
