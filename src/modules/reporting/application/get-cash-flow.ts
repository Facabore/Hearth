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
import { converterInto, type DisplayCurrencyOf, type ReportRates } from "./conversion";

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
  /** The ledger's `listScheduledMovements`. */
  readonly scheduled: ListScheduledMovements;
  /** The user's own accounts in their personal space, whether each counts in its available money, and that total. */
  readonly ownAccountsOf: (userId: string) => Promise<{
    readonly currency: string;
    readonly available: bigint;
    readonly accounts: readonly OwnAccount[];
  }>;
  /** D29, slice MC4: the dated rates the projection converts with; without them other currencies stay apart. */
  readonly rates?: ReportRates;
  /** D29, slice MC4: the caller's display currency; without it, their personal space's. */
  readonly displayCurrencyOf?: DisplayCurrencyOf;
}

export interface CashFlowView extends Omit<CashFlowProjection, "dates"> {
  readonly currency: string;
  /** D29, slice MC4: true when some figure was converted from another currency, so the projection is approximate. */
  readonly converted: boolean;
  /** D29, slice MC4: true when a rate it converted with was more than a week older than its day. */
  readonly stale: boolean;
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
 *
 * D29, slice MC4: in the caller's display currency. Today's available money converts at today's rate, and each
 * movement in another currency at the rate of its day (today's for one still ahead, the latest known); one with no rate
 * is left out and its space named. Without a rate for the opening, the projection stays in the personal space's
 * currency. This ends ruling P240's "other currencies out".
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
    const wanted = (await deps.displayCurrencyOf?.(userId)) ?? own.currency;
    const converter = converterInto(deps.rates, wanted);
    const converted = await converter.convert(own.available, own.currency, today);
    const [currency, opening] = converted === null ? [own.currency, own.available] : [wanted, converted];
    const into = currency === wanted ? converter : converterInto(deps.rates, currency);
    const movements = await Promise.all(
      listed.flat().map(async (m) => {
        if (m.currency === currency) return m;
        const value = await into.convert(m.amount, m.currency, m.date < today ? m.date : today);
        return value === null ? m : { ...m, converted: value };
      }),
    );
    const projection = cashFlow({ today, through, currency, opening, accounts: own.accounts, movements });
    return ok({
      ...projection,
      currency,
      from: today,
      through,
      days,
      opening,
      converted: into.converted,
      stale: into.stale,
      dates: projection.dates.map((d) => ({
        ...d,
        movements: d.movements.map((m) => ({ ...m, space: { id: m.spaceId, name: m.spaceName } })),
      })),
    });
  };
