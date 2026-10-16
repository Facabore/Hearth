import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import { MAX_UPCOMING, upcomingDates } from "../domain/recurrence";
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

type ReadDeps = Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">;

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
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_UPCOMING) {
      return err(domainError("InvalidRecurrence", { reason: "invalidCount", max: MAX_UPCOMING }));
    }
    const recurrence = await deps.recurrences.find(reader.value.spaceId, input.recurrenceId);
    if (recurrence === null) return err(domainError("RecurrenceNotFound"));
    return ok(upcomingDates(recurrence, input.count));
  };
