import {
  listPeriods,
  ok,
  todayIn,
  type Clock,
  type LocalDate,
  type Period,
  type Result,
  type StoredPeriod,
} from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";

/** Stored plan boundaries of a space (budgeting, HU-E6-01); empty until plans exist. */
export type StoredPeriodSource = (spaceId: string) => Promise<readonly StoredPeriod[]>;

export interface ListSpacePeriodsDeps {
  readonly access: SpaceAccess;
  readonly storedPeriods: StoredPeriodSource;
  readonly clock: Clock;
  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */
  readonly timeZone: string;
}

export type ListSpacePeriods = (input: {
  spaceId: string;
  userId: string;
  from?: LocalDate;
  count: number;
}) => Promise<Result<Period[]>>;

export const createListSpacePeriods =
  (deps: ListSpacePeriodsDeps): ListSpacePeriods =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const from = input.from ?? todayIn(deps.clock, deps.timeZone);
    const stored = await deps.storedPeriods(membership.value.spaceId);
    return ok(listPeriods(membership.value.periodPolicy, stored, from, input.count));
  };
