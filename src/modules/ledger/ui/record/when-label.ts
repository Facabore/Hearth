import { formatDate, formatTime, type Formats, type Wall } from "@/shared/ui/format/formatters";
import { relativeDay } from "@/shared/ui/time/when";

/** A record's day and wall-clock time, in its own zone. */
export interface When {
  readonly date: string;
  readonly wall: Wall;
}

/** "Hoy · 23:30": the day's name when it has one, else its date, then the time, both in the person's formats. */
export const whenLabel = (
  when: When,
  today: string,
  formats: Formats,
  days: { readonly today: string; readonly yesterday: string; readonly dayBeforeYesterday: string },
): string => {
  const relative = relativeDay(when.date, today);
  return `${relative ? days[relative] : formatDate(when.date, formats)} · ${formatTime(when.wall, formats)}`;
};
