import { domainError } from "./domain-error";
import { fromParts, partsOf, type LocalDate } from "./local-date";
import { err, ok, type Result } from "./result";

/** HU-E1-14: each user's own IANA zone; the composition root binds it to identity's profiles. */
export interface UserTimeZones {
  /** The user's canonical zone; the deployment's APP_TIMEZONE for an unknown user or an unusable stored value. */
  timeZoneOf(userId: string): Promise<string>;
}

/** A time of day as a zone's clock shows it. */
export interface WallTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterOf = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/**
 * HU-E1-14: the canonical name of a zone Intl accepts ("america/bogota" → "America/Bogota"); null otherwise.
 * Ruling P45 keeps "valid when Intl accepts it", which also admits offset names such as "+05:00"; restricting the
 * zone to IANA names is plan follow-up 2.
 */
export const canonicalTimeZone = (raw: string): string | null => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

/** HU-E1-14: a zone sent explicitly; an unknown one is InvalidTimeZone. */
export const parseTimeZone = (raw: string): Result<string> => {
  const zone = canonicalTimeZone(raw);
  return zone === null ? err(domainError("InvalidTimeZone", { value: raw })) : ok(zone);
};

const fieldsOf = (instant: Date, timeZone: string) => {
  const parts = new Map(
    formatterOf(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  );
  const field = (name: Intl.DateTimeFormatPartTypes) => parts.get(name) ?? 0;
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
};

/** The calendar date `timeZone`'s clock shows at `instant`; an unknown zone throws a RangeError, so pass canonical zones. */
export const localDateIn = (instant: Date, timeZone: string): LocalDate => {
  const { year, month, day } = fieldsOf(instant, timeZone);
  return fromParts(year, month, day);
};

/** The time of day `timeZone`'s clock shows at `instant`; an unknown zone throws a RangeError, so pass canonical zones. */
export const wallTimeIn = (instant: Date, timeZone: string): WallTime => {
  const { hour, minute, second } = fieldsOf(instant, timeZone);
  return { hour, minute, second, millisecond: instant.getUTCMilliseconds() };
};

/** The zone's offset from UTC at `instant`, in milliseconds (whole seconds). */
const offsetAt = (instant: number, timeZone: string): number => {
  const f = fieldsOf(new Date(instant), timeZone);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(instant / 1000) * 1000;
};

/** Offsets reach ±14 h, so a 12 h probe can land past the transition; a day lands safely on either side. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * HU-E4-14, ruling P42: the instant at which `timeZone`'s clock shows `wall` on `date`. A repeated time takes the
 * earlier instant; a skipped time moves forward by the gap (the offset before the change applies).
 */
export const instantAt = (date: LocalDate, wall: WallTime, timeZone: string): Date => {
  const { year, month, day } = partsOf(date);
  const local = Date.UTC(year, month - 1, day, wall.hour, wall.minute, wall.second, wall.millisecond);
  const before = local - offsetAt(local - DAY, timeZone);
  const after = local - offsetAt(local + DAY, timeZone);
  const valid = [before, after]
    .sort((a, b) => a - b)
    .find((candidate) => local - candidate === offsetAt(candidate, timeZone));
  return new Date(valid ?? before);
};
