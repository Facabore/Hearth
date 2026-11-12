import type { TransactionDto } from "@/shared/ui/api/dto";
import { relativeDay } from "@/shared/ui/time/when";

export interface DayGroup<T = TransactionDto> {
  readonly date: string;
  readonly relative: "today" | "yesterday" | null;
  readonly items: T[];
}

/**
 * Ruling P130: consecutive rows of one date, in the API's order (newest day first, untimed rows last, P43). Rows that
 * are not transactions (the personal Movimientos' entries, P319) say their date through `dateOf`.
 */
export function groupByDay(items: readonly TransactionDto[], today: string): DayGroup[];
export function groupByDay<T>(items: readonly T[], today: string, dateOf: (item: T) => string): DayGroup<T>[];
export function groupByDay<T>(
  items: readonly T[],
  today: string,
  dateOf: (item: T) => string = (item) => (item as TransactionDto).date,
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const date = dateOf(item);
    const last = groups.at(-1);
    if (last && last.date === date) last.items.push(item);
    else {
      const relative = relativeDay(date, today);
      groups.push({
        date,
        relative: relative === "today" || relative === "yesterday" ? relative : null,
        items: [item],
      });
    }
  }
  return groups;
}
