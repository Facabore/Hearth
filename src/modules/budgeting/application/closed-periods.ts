import type { LocalDate } from "@/shared/kernel";
import type { BudgetPlanRepository } from "./ports";

/** HU-E4-06, HU-E6-07: whether a date of a space falls within a CLOSED plan's stored period. */
export interface ClosedPeriods {
  isClosed(spaceId: string, date: LocalDate): Promise<boolean>;
}

/**
 * The ledger's ClosedPeriodGuard, bound by the composition root (the ledger never imports budgeting). It reads the
 * plan covering the date FOR SHARE (ruling P14): a ledger write waits for a close of that plan in progress and then
 * sees it, and a close waits for the ledger writes already inside the period.
 */
export const createClosedPeriodGuard = (plans: Pick<BudgetPlanRepository, "covering">): ClosedPeriods => ({
  isClosed: async (spaceId, date) =>
    (await plans.covering(spaceId, date, { share: true }))?.status === "CLOSED",
});
