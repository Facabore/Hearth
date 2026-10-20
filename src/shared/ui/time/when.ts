import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { instantAt, localDateIn, wallTimeIn } from "@/shared/kernel/time-zone";
import type { Wall, WeekStart } from "../format/formatters";

/** HU-E9-03: now on the zone's clock: the date and the wall time a new record starts from. */
export const nowIn = (now: Date, timeZone: string): { date: LocalDate; wall: Wall } => {
  const { hour, minute } = wallTimeIn(now, timeZone);
  return { date: localDateIn(now, timeZone), wall: { hour, minute } };
};

/** The names the date row uses; any other day is shown as a date. */
export const relativeDay = (
  date: string,
  today: string,
): "today" | "yesterday" | "dayBeforeYesterday" | null => {
  if (date === today) return "today";
  if (date === addDays(today as LocalDate, -1)) return "yesterday";
  if (date === addDays(today as LocalDate, -2)) return "dayBeforeYesterday";
  return null;
};

const fromMinutes = (total: number): Wall => {
  const minutes = (total + 1440) % 1440;
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
};

/** Ruling P129: to the next multiple of five in the direction pressed; the day never changes. */
export const stepMinutes = (wall: Wall, delta: 5 | -5): Wall => {
  const offset = wall.minute % 5;
  const step = offset === 0 ? delta : delta > 0 ? 5 - offset : -offset;
  return fromMinutes(wall.hour * 60 + wall.minute + step);
};

export const stepHour = (wall: Wall, delta: 1 | -1): Wall => ({
  hour: (wall.hour + delta + 24) % 24,
  minute: wall.minute,
});

/** AM or PM without touching the minutes. */
export const withHalf = (wall: Wall, half: "AM" | "PM"): Wall => {
  if (half === "AM" && wall.hour >= 12) return { ...wall, hour: wall.hour - 12 };
  if (half === "PM" && wall.hour < 12) return { ...wall, hour: wall.hour + 12 };
  return wall;
};

/** The instant sent as `occurredAt`: `wall` on `date` in `timeZone`. */
export const occurredAtOf = (date: string, wall: Wall, timeZone: string): string =>
  instantAt(date as LocalDate, { ...wall, second: 0, millisecond: 0 }, timeZone).toISOString();

const pad = (n: number) => String(n).padStart(2, "0");

/** A month laid out from the person's first weekday: leading nulls, then every day. */
export const monthGrid = (year: number, month: number, weekStart: WeekStart): (LocalDate | null)[] => {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (first - (weekStart === "MONDAY" ? 1 : 0) + 7) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}` as LocalDate),
  ];
};
