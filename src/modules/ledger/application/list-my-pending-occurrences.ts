import type { SpaceRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { createListPendingOccurrences, type PendingOccurrenceView } from "./pending-occurrences";
import type { RecurrenceDeps } from "./recurrence-ports";

/** A pending occurrence of one of the person's spaces, with the space it waits in (#338). */
export interface MyPendingOccurrence extends PendingOccurrenceView {
  readonly spaceId: string;
}

export type ListMyPendingOccurrences = (userId: string) => Promise<Result<MyPendingOccurrence[]>>;

export interface MyPendingOccurrencesDeps extends Pick<
  RecurrenceDeps,
  "access" | "recurrences" | "occurrences"
> {
  /** The person's current spaces, archived ones left out. */
  readonly spaces: Pick<SpaceRepository, "listForUser">;
}

/**
 * #338: Inicio's "Te necesita hoy" in one read, the pending occurrences of every current space of the person, space by
 * space in the order her space list gives, each space's earliest first. Each space goes through ListPendingOccurrences,
 * so it authorizes as that read does (every member reads, ruling P271); a space whose read refuses is left out.
 */
export const createListMyPendingOccurrences = (deps: MyPendingOccurrencesDeps): ListMyPendingOccurrences => {
  const listPending = createListPendingOccurrences(deps);
  return async (userId) => {
    const spaces = await deps.spaces.listForUser(userId);
    const perSpace = await Promise.all(
      spaces.map(async (space) => {
        const pending = await listPending({ spaceId: space.id, userId });
        return pending.ok ? pending.value.map((view) => ({ ...view, spaceId: space.id })) : [];
      }),
    );
    return ok(perSpace.flat());
  };
};
