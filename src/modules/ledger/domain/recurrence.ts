import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";
import { nextSlotStart, sameSchedule, scheduleDates, type Schedule } from "./recurrence-schedule";
import type { SplitInput } from "./split";
import { positiveAmount } from "./transaction";

export type RecurrenceId = Id<"Recurrence">;
export type RecurrenceMode = "AUTO" | "CONFIRM";
export type RecurrenceStatus = "ACTIVE" | "PAUSED" | "ENDED";

/** Ruling P23: a recurrence shares by ratios only; EXACT amounts could not follow an estimate or a later amount. */
export type RecurrenceSplit = Exclude<SplitInput, { readonly method: "EXACT" }>;

/**
 * Spec 5.2: what every occurrence records besides its date and amount. Its type, payer and accounts stay as defined
 * (ruling P22); an expense's category and split, and an income's category, may change.
 */
export type RecurrenceTemplate =
  | {
      readonly type: "EXPENSE";
      readonly categoryId: string;
      /** A member (registered, or a guest with no account) and their account, or the fund (memberId null). */
      readonly payer: { readonly memberId: string | null; readonly accountId: string | null };
      /** Null: the default split of each occurrence (spec 5.3, ruling P23). */
      readonly split: RecurrenceSplit | null;
    }
  | { readonly type: "INCOME"; readonly categoryId: string; readonly accountId: string }
  | { readonly type: "TRANSFER"; readonly sourceAccountId: string; readonly destinationAccountId: string }
  | {
      readonly type: "FUND_CONTRIBUTION";
      readonly fundAccountId: string;
      readonly memberId: string;
      /** Null for a guest, who contributes from outside the app (HU-E4-09). */
      readonly sourceAccountId: string | null;
    };

export type RecurrenceType = RecurrenceTemplate["type"];

export interface Recurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
  readonly description: string;
  /** AUTO: what each occurrence records; CONFIRM: the estimate a pending occurrence suggests. Minor units. */
  readonly amount: bigint;
  readonly currency: string;
  readonly template: RecurrenceTemplate;
  readonly schedule: Schedule;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  /** The first date the scheduler has not considered yet: catch-up starts here (spec 5.2, ruling P24). */
  readonly dueFrom: LocalDate;
  readonly pausedAt: Date | null;
  /** Null when a member paused it; PayerLeft, CreatorLeft or the code that refused an occurrence otherwise (P26). */
  readonly pauseReason: string | null;
  readonly endedAt: Date | null;
  /** The user who defined it: every AUTO occurrence is recorded on their behalf (ruling P21). */
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MAX_DESCRIPTION = 200;
/** HU-E4-11: GET …/occurrences lists at most this many upcoming dates. */
export const MAX_UPCOMING = 24;

const describedAs = (raw: string): Result<string> => {
  const text = raw.trim();
  return text.length > 0 && text.length <= MAX_DESCRIPTION
    ? ok(text)
    : err(domainError("InvalidDescription", { length: text.length }));
};

const endsOnOrAfter = (startDate: LocalDate, endDate: LocalDate | null): Result<void> =>
  endDate === null || endDate >= startDate
    ? ok(undefined)
    : err(domainError("InvalidRecurrence", { reason: "endsBeforeStart" }));

export interface NewRecurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly template: RecurrenceTemplate;
  readonly schedule: Schedule;
  readonly mode: RecurrenceMode;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  readonly createdBy: string;
  readonly now: Date;
  /** The definition day in the space timezone. */
  readonly today: LocalDate;
}

/** The schedule dates from the first not considered yet through the end date, at most `limit`. */
const datesLeft = (
  recurrence: Pick<Recurrence, "schedule" | "dueFrom" | "endDate">,
  limit: number,
): LocalDate[] =>
  scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through: recurrence.endDate }, limit);

/**
 * HU-E4-11: a new recurrence is ACTIVE. It is due from its start date, or from the definition day when it starts
 * earlier: a recurrence never back-fills days before it existed (ruling P24). A definition with no schedule date
 * from there through its end date could never record anything and is refused.
 */
export const defineRecurrence = (input: NewRecurrence): Result<Recurrence> => {
  const amount = positiveAmount(input.amount);
  if (!amount.ok) return amount;
  const description = describedAs(input.description);
  if (!description.ok) return description;
  const dates = endsOnOrAfter(input.startDate, input.endDate);
  if (!dates.ok) return dates;
  const dueFrom = input.startDate > input.today ? input.startDate : input.today;
  if (datesLeft({ schedule: input.schedule, dueFrom, endDate: input.endDate }, 1).length === 0) {
    return err(domainError("InvalidRecurrence", { reason: "noOccurrence" }));
  }
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    description: description.value,
    amount: amount.value,
    currency: input.currency,
    template: input.template,
    schedule: input.schedule,
    mode: input.mode,
    startDate: input.startDate,
    endDate: input.endDate,
    dueFrom,
    pausedAt: null,
    pauseReason: null,
    endedAt: null,
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now,
  });
};

/** HU-E4-11: the next `count` dates it will record, from the first not considered yet; none while paused or ended. */
export const upcomingDates = (recurrence: Recurrence, count: number): LocalDate[] =>
  recurrence.pausedAt !== null || recurrence.endedAt !== null ? [] : datesLeft(recurrence, count);

/** ENDED once ended or once no schedule date is left up to its end date, PAUSED while paused, ACTIVE otherwise. */
export const statusOf = (recurrence: Recurrence): RecurrenceStatus => {
  if (recurrence.endedAt !== null) return "ENDED";
  if (datesLeft(recurrence, 1).length === 0) return "ENDED";
  return recurrence.pausedAt === null ? "ACTIVE" : "PAUSED";
};

/** HU-E4-11: what an edit may change (ruling P22); the type, payer and accounts stay as defined. */
export interface RecurrenceChanges {
  readonly description?: string;
  readonly amount?: bigint;
  readonly categoryId?: string;
  /** Null returns to the default split of each occurrence (ruling P23). */
  readonly split?: RecurrenceSplit | null;
  readonly schedule?: Schedule;
  readonly mode?: RecurrenceMode;
  readonly endDate?: LocalDate | null;
}

const revisedTemplate = (
  template: RecurrenceTemplate,
  changes: RecurrenceChanges,
): Result<RecurrenceTemplate> => {
  let revised = template;
  if (changes.categoryId !== undefined) {
    if (revised.type !== "EXPENSE" && revised.type !== "INCOME") {
      return err(domainError("InvalidRecurrence", { reason: "noCategory" }));
    }
    revised = { ...revised, categoryId: changes.categoryId };
  }
  if (changes.split !== undefined) {
    if (revised.type !== "EXPENSE") return err(domainError("InvalidRecurrence", { reason: "noSplit" }));
    revised = { ...revised, split: changes.split };
  }
  return ok(revised);
};

/** When an edit is made, and where the schedule it may change stands then. */
export interface EditContext {
  readonly now: Date;
  /** The edit day in the space timezone. */
  readonly today: LocalDate;
  /** The date of the recurrence's last occurrence, whatever its status; null before the first. */
  readonly lastOccurrence: LocalDate | null;
}

/**
 * Final review I1: where a new schedule is due from. It never creates a date before the edit day, nor a second
 * occurrence in the slot of the last one (`nextSlotStart`): it is due from the later of the edit day and the start of
 * the next slot, or, before any occurrence, from the later of the edit day and where it was due from.
 */
const rescheduledFrom = (current: Recurrence, schedule: Schedule, edit: EditContext): LocalDate => {
  const from = edit.lastOccurrence === null ? current.dueFrom : nextSlotStart(schedule, edit.lastOccurrence);
  return from > edit.today ? from : edit.today;
};

/**
 * HU-E4-11: an edit applies to every occurrence not recorded yet, an overdue date no run has considered included;
 * recorded ones are snapshots (ruling P24). A schedule change is the exception: it is due from `rescheduledFrom`. An
 * ENDED recurrence takes no edit, whether it was ended or ran out of dates: extending it would back-fill the days it
 * was over, so a finished recurrence is continued by defining a new one.
 */
export const revisedRecurrence = (
  current: Recurrence,
  changes: RecurrenceChanges,
  edit: EditContext,
): Result<Recurrence> => {
  if (statusOf(current) === "ENDED") return err(domainError("RecurrenceEnded"));
  const description =
    changes.description === undefined ? ok(current.description) : describedAs(changes.description);
  if (!description.ok) return description;
  const amount = changes.amount === undefined ? ok(current.amount) : positiveAmount(changes.amount);
  if (!amount.ok) return amount;
  const template = revisedTemplate(current.template, changes);
  if (!template.ok) return template;
  const endDate = changes.endDate === undefined ? current.endDate : changes.endDate;
  const dates = endsOnOrAfter(current.startDate, endDate);
  if (!dates.ok) return dates;
  const rescheduled = changes.schedule !== undefined && !sameSchedule(changes.schedule, current.schedule);
  const schedule = changes.schedule ?? current.schedule;
  return ok({
    ...current,
    description: description.value,
    amount: amount.value,
    template: template.value,
    schedule,
    mode: changes.mode ?? current.mode,
    endDate,
    dueFrom: rescheduled ? rescheduledFrom(current, schedule, edit) : current.dueFrom,
    updatedAt: edit.now,
  });
};

const refused = (from: RecurrenceStatus, to: RecurrenceStatus): Result<never> =>
  err(domainError("InvalidRecurrenceTransition", { from, to }));

/** HU-E4-11: only an ACTIVE recurrence pauses; `reason` is null when a member pauses it (ruling P26). */
export const pausedRecurrence = (
  recurrence: Recurrence,
  now: Date,
  reason: string | null = null,
): Result<Recurrence> => {
  const status = statusOf(recurrence);
  return status === "ACTIVE"
    ? ok({ ...recurrence, pausedAt: now, pauseReason: reason, updatedAt: now })
    : refused(status, "PAUSED");
};

/**
 * HU-E4-11: a PAUSED recurrence resumes from `today` at the earliest, so the days it was paused are never back-filled
 * and a resume never moves `dueFrom` backwards (ruling P24). One whose end date passed during the pause would resume
 * into ENDED, a move no transition allows, so it is refused like any ENDED one; a member can still end it (ruling P27).
 */
export const resumedRecurrence = (
  recurrence: Recurrence,
  now: Date,
  today: LocalDate,
): Result<Recurrence> => {
  const status = statusOf(recurrence);
  if (status !== "PAUSED") return refused(status, "ACTIVE");
  const resumed: Recurrence = {
    ...recurrence,
    pausedAt: null,
    pauseReason: null,
    dueFrom: recurrence.dueFrom > today ? recurrence.dueFrom : today,
    updatedAt: now,
  };
  return statusOf(resumed) === "ENDED" ? refused(status, "ACTIVE") : ok(resumed);
};

/** HU-E4-11, D8: ending is logical; the recurrence and its occurrences stay, and nothing else is ever recorded. */
export const endedRecurrence = (recurrence: Recurrence, now: Date): Result<Recurrence> => {
  const status = statusOf(recurrence);
  return status === "ENDED" ? refused(status, "ENDED") : ok({ ...recurrence, endedAt: now, updatedAt: now });
};

/** D9 (ruling P22): whether its occurrences debit a member's own account, so only that member changes how much. */
export const debitsPersonalAccount = (template: RecurrenceTemplate): boolean => {
  switch (template.type) {
    case "EXPENSE":
      return template.payer.memberId !== null && template.payer.accountId !== null;
    case "FUND_CONTRIBUTION":
      return template.sourceAccountId !== null;
    case "TRANSFER":
      return true;
    case "INCOME":
      return false;
  }
};

/**
 * D9 (ruling P22), as extended: whether its occurrences move money into or out of a member's own account, so only that
 * member, its creator, changes or resumes it. Recording allows only a member's own accounts for incomes and
 * transfers, so an income credits the creator's account.
 */
export const touchesPersonalAccount = (template: RecurrenceTemplate): boolean =>
  template.type === "INCOME" || debitsPersonalAccount(template);

/** The member its occurrences take money from: an expense's paying member or a contribution's; null for the fund. */
export const payerOf = (template: RecurrenceTemplate): string | null =>
  template.type === "EXPENSE"
    ? template.payer.memberId
    : template.type === "FUND_CONTRIBUTION"
      ? template.memberId
      : null;

/**
 * Ruling P26: why a recurrence can record nothing more because someone left the space: its paying member first
 * (PayerLeft, HU-E4-11), then the user who defined it, on whose behalf it records (CreatorLeft).
 */
export const blockerOf = (
  recurrence: Recurrence,
  current: readonly { readonly id: string; readonly userId: string | null }[],
): "PayerLeft" | "CreatorLeft" | null => {
  const payer = payerOf(recurrence.template);
  if (payer !== null && !current.some((member) => member.id === payer)) return "PayerLeft";
  return current.some((member) => member.userId === recurrence.createdBy) ? null : "CreatorLeft";
};
