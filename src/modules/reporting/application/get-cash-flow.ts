import type { ListScheduledMovements } from "@/modules/ledger/application";
import {
  addDays,
  ok,
  todayIn,
  type Clock,
  type LocalDate,
  type Result,
  type UserTimeZones,
} from "@/shared/kernel";
import {
  cashFlow,
  type CashFlowDate,
  type CashFlowMovement,
  type CashFlowProjection,
  type OwnAccount,
} from "../domain/cash-flow";

/** Ruling P241 (M6c): the windows the calendar offers. */
export const CASH_FLOW_DAYS = [30, 60] as const;
export type CashFlowDays = (typeof CASH_FLOW_DAYS)[number];

/** What the caller's cash flow reads; the composition root binds each port (ruling P238). */
export interface CashFlowDeps {
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
  /** The spaces the user is a current member of, archived ones left out, oldest first. */
  readonly spacesOf: (
    userId: string,
  ) => Promise<readonly { readonly spaceId: string; readonly name: string }[]>;
  /** The ledger's `listScheduledMovements` (Task 1c). */
  readonly scheduled: ListScheduledMovements;
  /** The user's own accounts in their personal space, whether each counts in its available money, and that total. */
  readonly ownAccountsOf: (userId: string) => Promise<{
    readonly currency: string;
    readonly available: bigint;
    readonly accounts: readonly OwnAccount[];
  }>;
}

export interface CashFlowView extends Omit<CashFlowProjection, "dates"> {
  readonly currency: string;
  readonly from: LocalDate;
  readonly through: LocalDate;
  readonly days: CashFlowDays;
  readonly opening: bigint;
  readonly dates: readonly (Omit<CashFlowDate, "movements"> & {
    readonly movements: readonly (CashFlowMovement & {
      readonly space: { readonly id: string; readonly name: string };
    })[];
  })[];
}

export type GetCashFlow = (input: {
  readonly userId: string;
  readonly days: CashFlowDays;
}) => Promise<Result<CashFlowView>>;

/**
 * #150, ruling P238 (M6c): what comes into and goes out of the caller's own accounts from today, in their zone,
 * through `days` − 1 days later, across every space they are a current member of, with the balance after each date.
 */
export const createGetCashFlow =
  (deps: CashFlowDeps): GetCashFlow =>
  async ({ userId, days }) => {
    const today = todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(userId));
    const through = addDays(today, days - 1);
    const [spaces, own] = await Promise.all([deps.spacesOf(userId), deps.ownAccountsOf(userId)]);
    const listed = await Promise.all(
      spaces.map(async (space) =>
        (await deps.scheduled({ spaceId: space.spaceId, through })).map((m) => ({
          ...m,
          spaceId: space.spaceId,
          spaceName: space.name,
        })),
      ),
    );
    const projection = cashFlow({
      today,
      through,
      currency: own.currency,
      opening: own.available,
      accounts: own.accounts,
      movements: listed.flat(),
    });
    return ok({
      ...projection,
      currency: own.currency,
      from: today,
      through,
      days,
      opening: own.available,
      dates: projection.dates.map((d) => ({
        ...d,
        movements: d.movements.map((m) => ({ ...m, space: { id: m.spaceId, name: m.spaceName } })),
      })),
    });
  };
