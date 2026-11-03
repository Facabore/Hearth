import type { TransactionDto } from "@/shared/ui/api/dto";
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
