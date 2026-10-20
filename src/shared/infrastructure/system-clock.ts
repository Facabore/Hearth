import { FixedClock, type Clock } from "@/shared/kernel";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Ruling P133: the e2e run's fixed instant, else the system clock. */
export const clockFrom = (fixedNow: string | undefined): Clock =>
  fixedNow ? new FixedClock(new Date(fixedNow)) : new SystemClock();
