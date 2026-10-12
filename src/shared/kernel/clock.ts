import type { LocalDate } from "./local-date";

export interface Clock {
  now(): Date;
}

/** Deterministic clock for tests and replayable use cases. */
export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return new Date(this.instant);
  }
}

export const todayIn = (clock: Clock, timeZone: string): LocalDate =>
  // en-CA formats as YYYY-MM-DD
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    clock.now(),
  ) as LocalDate;
