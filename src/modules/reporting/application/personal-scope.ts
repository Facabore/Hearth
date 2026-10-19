import type { BudgetPlanRepository, PlanSpending } from "@/modules/budgeting/application";
import type { MemberPlace, MemberPlaceRepository } from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  periodByLabel,
  type LocalDate,
  type Period,
  type Result,
  type StoredPeriod,
} from "@/shared/kernel";

/** HU-E7-04: one user's sums across their member rows, by the ledger on read (D7). */
export interface PersonalSums {
  /** Σ the members' shares of live expenses per space and category. */
  consumptionByCategory(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<readonly { readonly spaceId: string; readonly categoryId: string; readonly amount: bigint }[]>;
  /** Σ the members' payments and fund contributions, each with the part without an account. */
  cashOut(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{
    readonly payments: bigint;
    readonly paymentsOutsideTheApp: bigint;
    readonly fundContributions: bigint;
    readonly contributionsOutsideTheApp: bigint;
  }>;
}

/**
 * The live categories of a space with their catalog keys (D11) and parents (HU-E3-04), archived ones included;
 * bound to the categories module.
 */
export interface ReportCategories {
  listCategories(spaceId: string): Promise<
    readonly {
      readonly id: string;
      readonly key: string | null;
      readonly name: string;
      readonly parentCategoryId: string | null;
    }[]
  >;
}

/**
 * The ids of the user's own SAVINGS accounts, archived ones included; bound to the accounts module. Only the accounts
 * of the user's personal space (HU-E2-01), so in its currency (D6): the unified view adds their transfers to a total
 * in that currency without converting.
 */
export type SavingsAccountsOf = (userId: string) => Promise<readonly string[]>;

/** What the caller's own reports need (HU-E7-04, HU-E7-05); the composition root binds each port. */
export interface PersonalDeps {
  readonly places: MemberPlaceRepository;
  readonly plans: Pick<BudgetPlanRepository, "storedPeriods">;
  readonly sums: PersonalSums;
  /** Not `categories`: the shared `reportingDeps` holds budgeting's port under that key for `loadPlanView`. */
  readonly catalog: ReportCategories;
  readonly spending: Pick<PlanSpending, "transfersIntoAccounts">;
  readonly savingsAccountsOf: SavingsAccountsOf;
}

export interface PersonalScope {
  readonly personal: MemberPlace;
  readonly period: Period;
  /** The stored periods of the personal space's plans (D10). */
  readonly stored: readonly StoredPeriod[];
  /** The caller's member rows in spaces of the personal space's currency (D6, ruling P37). */
  readonly places: readonly MemberPlace[];
  /** The caller's member rows in spaces of another currency, left out of every sum (ruling P37). */
  readonly otherCurrencies: readonly MemberPlace[];
}

/**
 * HU-E7-04, D11: the caller's personal space, the period named `label` in its policy (a stored one first, D10) and
 * every member row linked to the caller (spec 5.4). Only the caller's own rows are read, so no one else's personal
 * data can reach their view.
 */
export const personalScope = async (
  deps: PersonalDeps,
  userId: string,
  label: string,
): Promise<Result<PersonalScope>> => {
  const places = await deps.places.placesOf(userId);
  // HU-E1-02: every user has one personal space; without one there is nothing to read.
  const personal = places.find((p) => p.spaceKind === "PERSONAL");
  if (personal === undefined) return err(domainError("SpaceNotFound"));
  const stored = await deps.plans.storedPeriods(personal.spaceId);
  const period = periodByLabel(personal.periodPolicy, stored, label);
  if (!period.ok) return period;
  return ok({
    personal,
    period: period.value,
    stored,
    places: places.filter((p) => p.currency === personal.currency),
    otherCurrencies: places.filter((p) => p.currency !== personal.currency),
  });
};

/** Σ the caller's consumption within `period` across `scope.places` (spec 5.4). */
export const consumptionTotal = async (
  deps: PersonalDeps,
  scope: PersonalScope,
  period: Period,
): Promise<bigint> => {
  const rows = await deps.sums.consumptionByCategory(
    scope.places.map((p) => p.memberId),
    period.start,
    period.end,
  );
  return rows.reduce((sum, row) => sum + row.amount, 0n);
};
