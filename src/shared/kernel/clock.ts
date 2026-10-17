import type { LocalDate } from "./local-date";
import { localDateIn } from "./time-zone";

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

export const todayIn = (clock: Clock, timeZone: string): LocalDate => localDateIn(clock.now(), timeZone);
