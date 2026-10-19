import { ok, type Period, type Result } from "@/shared/kernel";
import { changeFrom, periodsEndingWith, type Change } from "../domain/trend";
import { consumptionTotal, personalScope, type PersonalDeps } from "./personal-scope";

export interface PersonalTrendPoint {
  readonly period: Period;
  /** The caller's consumption in the period, as the unified view totals it (HU-E7-04). */
  readonly consumption: bigint;
  readonly change: Change;
}

export interface PersonalTrend {
  readonly currency: string;
  /** The caller's personal periods, oldest first, ending with the end period. */
  readonly periods: readonly Period[];
  readonly points: readonly PersonalTrendPoint[];
}

export interface PersonalTrendInput {
  readonly userId: string;
  readonly endPeriod: string;
  readonly periods: number;
}

export type GetPersonalTrend = (input: PersonalTrendInput) => Promise<Result<PersonalTrend>>;

/**
 * HU-E7-05: the caller's consumption per period of their personal space's policy, each compared with the one before,
 * the first one shown included; only the caller's own member rows are read (HU-E7-04).
 */
export const createGetPersonalTrend =
  (deps: PersonalDeps): GetPersonalTrend =>
  async (input) => {
    const scope = await personalScope(deps, input.userId, input.endPeriod);
    if (!scope.ok) return scope;
    const { personal, period, stored } = scope.value;
    const window = periodsEndingWith(personal.periodPolicy, stored, period, input.periods + 1);
    const totals = await Promise.all(window.map((p) => consumptionTotal(deps, scope.value, p)));
    const shown = window.slice(1);
    return ok({
      currency: personal.currency,
      periods: shown,
      points: shown.map((p, i) => {
        const consumption = totals[i + 1] ?? 0n;
        return { period: p, consumption, change: changeFrom(totals[i] ?? null, consumption) };
      }),
    });
  };
