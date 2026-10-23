import { formatDate, formatTime, type Formats, type Wall } from "@/shared/ui/format/formatters";
import { relativeDay } from "@/shared/ui/time/when";

/** A record's day and wall-clock time, in its own zone. */
export interface When {
  readonly date: string;
  readonly wall: Wall;
}

/**
 * The parts a sentence about a record's moment needs: which named day it is (`other` when it has no name), its date
 * and its time in the person's formats. A message selects on `day`, so each language words the named days in place
 * ("Usar anteayer · 20:06") instead of code changing their case (issue #166).
 */
export const whenParts = (
  when: When,
  today: string,
  formats: Formats,
): { day: "today" | "yesterday" | "dayBeforeYesterday" | "other"; date: string; time: string } => ({
  day: relativeDay(when.date, today) ?? "other",
  date: formatDate(when.date, formats),
  time: formatTime(when.wall, formats),
});

/** "Hoy · 23:30": the day's name when it has one, else its date, then the time, both in the person's formats. */
export const whenLabel = (
  when: When,
  today: string,
  formats: Formats,
  days: { readonly today: string; readonly yesterday: string; readonly dayBeforeYesterday: string },
): string => {
  const { day, date, time } = whenParts(when, today, formats);
  return `${day === "other" ? date : days[day]} · ${time}`;
};
