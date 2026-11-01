import { authorizeSpaceAction } from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  todayIn,
  type LocalDate,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";
import { MAX_UPCOMING, previewDates, upcomingDates } from "../domain/recurrence";
import { scheduleOf } from "../domain/recurrence-schedule";
import type { RecurrenceDeps } from "./recurrence-ports";
import { viewsOf, type RecurrenceView } from "./recurrence-view";

export type ListRecurrences = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<RecurrenceView[]>>;
export type GetRecurrence = (input: {
  spaceId: string;
  userId: string;
  recurrenceId: string;
}) => Promise<Result<RecurrenceView>>;
export type ListUpcomingOccurrences = (input: {
  spaceId: string;
  userId: string;
  recurrenceId: string;
  /** An integer from 1 to MAX_UPCOMING (24); InvalidRecurrence otherwise. */
  count: number;
}) => Promise<Result<LocalDate[]>>;

export type PreviewSchedule = (input: {
  spaceId: string;
  userId: string;
  schedule: PeriodPolicy;
  startDate: LocalDate;
  endDate: LocalDate | null;
  /** An integer from 1 to MAX_UPCOMING (24); InvalidRecurrence otherwise. */
  count: number;
}) => Promise<Result<LocalDate[]>>;

type ReadDeps = Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">;

const countIsValid = (count: number) => Number.isInteger(count) && count >= 1 && count <= MAX_UPCOMING;

/** HU-E4-11: any member reads the space's recurrences (space.read), archived spaces included (HU-E1-09). */
export const createListRecurrences =
  (deps: ReadDeps): ListRecurrences =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const spaceId = reader.value.spaceId;
    return ok(await viewsOf(deps.occurrences, spaceId, await deps.recurrences.list(spaceId)));
  };

export const createGetRecurrence =
  (deps: ReadDeps): GetRecurrence =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const recurrence = await deps.recurrences.find(reader.value.spaceId, input.recurrenceId);
    if (recurrence === null) return err(domainError("RecurrenceNotFound"));
    const [view] = await viewsOf(deps.occurrences, reader.value.spaceId, [recurrence]);
    return ok(view!);
  };

/**
 * HU-E4-11 `GET …/occurrences?count`: the next dates it will record, none while paused or ended. A count that is not
 * an integer from 1 to MAX_UPCOMING is refused, never clamped, so the schedule is never asked for an unbounded list.
 */
export const createListUpcomingOccurrences =
  (deps: ReadDeps): ListUpcomingOccurrences =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    if (!countIsValid(input.count)) {
      return err(domainError("InvalidRecurrence", { reason: "invalidCount", max: MAX_UPCOMING }));
    }
    const recurrence = await deps.recurrences.find(reader.value.spaceId, input.recurrenceId);
    if (recurrence === null) return err(domainError("RecurrenceNotFound"));
    return ok(upcomingDates(recurrence, input.count));
  };

/**
 * #77 (HU-E9-09) `POST …/recurrences/preview`: the dates a schedule would record before the recurrence is defined, so
 * the form never does date math on the client. Any member may preview (space.read); the schedule, the dates and the
 * count are checked as a definition checks them, and nothing is stored.
 */
export const createPreviewSchedule =
  (deps: Pick<RecurrenceDeps, "access" | "clock" | "timeZone">): PreviewSchedule =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const schedule = scheduleOf(input.schedule);
    if (!schedule.ok) return schedule;
    if (!countIsValid(input.count)) {
      return err(domainError("InvalidRecurrence", { reason: "invalidCount", max: MAX_UPCOMING }));
    }
    return previewDates(
      {
        schedule: schedule.value,
        startDate: input.startDate,
        endDate: input.endDate,
        today: todayIn(deps.clock, deps.timeZone),
      },
      input.count,
    );
  };
