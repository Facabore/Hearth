import type { MemberPlace } from "@/modules/spaces/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import type { PaletteKey } from "@/shared/kernel/style";
import { cashOutOf, consumptionGroups, type CashOut } from "../domain/unified-view";
import { converterInto, daysOf } from "./conversion";
import { personalScope, type PaidOutIn, type PersonalDeps } from "./personal-scope";

/** One group of the caller's consumption: a catalog key, or a custom category with its space ("space / category"). */
export interface UnifiedGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (ruling P76). */
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly category: { readonly id: string; readonly name: string } | null;
  readonly amount: bigint;
  /** #240 (board E9-11 01): the spaces the row's consumption came from, the personal space first. */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
}

/** Ruling P306: the caller's consumption and what they paid in one space, for Inicio's breakdown. */
export interface SpaceFigures {
  readonly space: {
    readonly id: string;
    readonly name: string;
    readonly kind: "PERSONAL" | "SHARED" | "DIRECT";
    readonly color: PaletteKey;
  };
  /** Σ the caller's shares of the space's live expenses in the period. */
  readonly consumed: bigint;
  /** Σ the caller's payments of the space's expenses and fund contributions in the period (spec 5.4). */
  readonly paid: bigint;
  /**
   * Ruling P306 ("Solo tú"): the personal space only, what it spent per category, a subcategory under its parent, the
   * largest first, each with the color the category shows (null without one).
   */
  readonly categories?: readonly {
    readonly id: string;
    readonly name: string;
    readonly color: PaletteKey | null;
    readonly amount: bigint;
  }[];
}

export interface UnifiedPersonalView {
  /** D29, slice MC4: the caller's display currency (their personal space's by default), every amount's. */
  readonly currency: string;
  /** The caller's personal-space period; shared transactions are placed in it by date (D11). */
  readonly period: Period;
  readonly consumption: { readonly total: bigint; readonly groups: readonly UnifiedGroup[] };
  readonly cashOut: CashOut;
  /**
   * Ruling P306: the figures per space, the personal one first and then every other space with consumption or payments
   * in the period; Σ consumed is the consumption's total. Savings transfers are no space's, so Σ paid leaves them out.
   */
  readonly bySpace: readonly SpaceFigures[];
  /** D29, slice MC4: spaces with movements on a day with no rate into `currency`, left out of every sum, named once. */
  readonly otherCurrencySpaces: readonly {
    readonly spaceId: string;
    readonly name: string;
    readonly currency: string;
  }[];
  /** D29, slice MC4: true when some figure was converted from another currency, so the view is approximate. */
  readonly converted: boolean;
  /** D29, slice MC4: true when a rate it converted with was more than a week older than its day. */
  readonly stale: boolean;
}

/** Ruling P306: the personal space's spending per top-level category, the largest first. */
const personalCategories = (
  rows: readonly { readonly spaceId: string; readonly categoryId: string; readonly amount: bigint }[],
  categories: readonly {
    readonly id: string;
    readonly spaceId: string;
    readonly name: string;
    readonly parentCategoryId: string | null;
    readonly style?: { readonly color: PaletteKey } | null;
  }[],
  personalSpaceId: string,
): NonNullable<SpaceFigures["categories"]> => {
  const own = categories.filter((c) => c.spaceId === personalSpaceId);
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    if (row.spaceId !== personalSpaceId) continue;
    const category = own.find((c) => c.id === row.categoryId);
    const top = category?.parentCategoryId ?? row.categoryId;
    totals.set(top, (totals.get(top) ?? 0n) + row.amount);
  }
  return [...totals.entries()]
    .map(([id, amount]) => {
      const category = own.find((c) => c.id === id);
      return { id, name: category?.name ?? "", color: category?.style?.color ?? null, amount };
    })
    .filter((c) => c.amount !== 0n)
    .sort((a, b) => (a.amount === b.amount ? a.name.localeCompare(b.name) : a.amount > b.amount ? -1 : 1));
};

export type GetUnifiedPersonalView = (input: {
  readonly userId: string;
  readonly period: string;
}) => Promise<Result<UnifiedPersonalView>>;

/** Spec 5.4: what one set of member rows paid out in one currency, as `PersonalSums.cashOut` answers it. */
type PaidOut = Omit<PaidOutIn, "currency">;
const NOTHING_PAID: PaidOut = {
  payments: 0n,
  paymentsOutsideTheApp: 0n,
  fundContributions: 0n,
  contributionsOutsideTheApp: 0n,
};
const paidSomething = (out: PaidOut) => Object.values(out).some((amount) => amount !== 0n);
const addPaid = (a: PaidOut, b: PaidOut): PaidOut => ({
  payments: a.payments + b.payments,
  paymentsOutsideTheApp: a.paymentsOutsideTheApp + b.paymentsOutsideTheApp,
  fundContributions: a.fundContributions + b.fundContributions,
  contributionsOutsideTheApp: a.contributionsOutsideTheApp + b.contributionsOutsideTheApp,
});
type Row = { readonly spaceId: string; readonly categoryId: string; readonly amount: bigint };
/** Ruling P342: one currency's figures without it, nothing paid when absent. */
const withoutCurrency = (out: PaidOutIn | undefined): PaidOut =>
  out === undefined
    ? NOTHING_PAID
    : {
        payments: out.payments,
        paymentsOutsideTheApp: out.paymentsOutsideTheApp,
        fundContributions: out.fundContributions,
        contributionsOutsideTheApp: out.contributionsOutsideTheApp,
      };
const rowOf = (row: Row): Row => ({ spaceId: row.spaceId, categoryId: row.categoryId, amount: row.amount });

/**
 * HU-E7-04, spec 5.4, D11: everything the caller consumed in a personal period (their shares in every space they are
 * or were a member of, the history of a claimed guest place included) and their cash out, computed on read (D7).
 *
 * D29, slice MC4 (design §4.1): every amount is in the caller's display currency (their personal space's unless they
 * chose one). A space in another currency is read day by day and each day's figures convert at that day's rate,
 * through `Money.convert`; a day with no rate is left out of every sum and its space named in `otherCurrencySpaces`,
 * never counted at 1:1. This ends ruling P37's "other currencies apart". Ruling P342: a space holds movements in several
 * currencies, so each converts from the movement's own currency, not from its space's.
 */
export const createGetUnifiedPersonalView =
  (deps: PersonalDeps): GetUnifiedPersonalView =>
  async ({ userId, period: label }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period } = scope.value;
    const currency = (await deps.displayCurrencyOf?.(userId)) ?? personal.currency;
    const converter = converterInto(deps.rates, currency);
    const allPlaces = [...scope.value.places, ...scope.value.otherCurrencies];
    const unconverted = new Map<string, { spaceId: string; name: string; currency: string }>();
    // Ruling P342: named with the movement currency that had no rate, once per space.
    const apart = (p: MemberPlace, from: string) =>
      unconverted.set(p.spaceId, { spaceId: p.spaceId, name: p.spaceName, currency: from });

    // Ruling P306: one read per space, over every member row of the caller there (a former one included).
    // The personal space first, even when a claimed guest place is older than the person's sign-up; then the others.
    const spacesOf = [...new Map(allPlaces.map((p) => [p.spaceId as string, p])).values()].sort(
      (a, b) => Number(b.spaceId === personal.spaceId) - Number(a.spaceId === personal.spaceId),
    );
    // Ruling P342: every movement keeps its own currency, whatever its space's. What is in the display currency adds up
    // as it is; what the caller consumed and paid out is read once over every member row, each space's own paid part
    // below.
    const memberIds = allPlaces.map((p) => p.memberId);
    const consumed = await deps.sums.consumptionByCurrency(memberIds, period.start, period.end);
    const rows: Row[] = [];
    let paidOut = withoutCurrency(
      (await deps.sums.cashOut(memberIds, period.start, period.end)).find((out) => out.currency === currency),
    );
    const figures = new Map<string, PaidOut>();
    for (const place of spacesOf) {
      const rowsIn = allPlaces.filter((p) => p.spaceId === place.spaceId).map((p) => p.memberId);
      const own = <T extends { readonly spaceId: string }>(list: readonly T[]) =>
        list.filter((row) => row.spaceId === place.spaceId);
      const whole = own(consumed);
      const out = await deps.sums.cashOut(rowsIn, period.start, period.end);
      for (const row of whole) if (row.currency === currency) rows.push(rowOf(row));
      let paid = withoutCurrency(out.find((o) => o.currency === currency));
      // D29 (MC4), P342: another currency. Nothing to convert unless the period holds something; then day by day, each
      // movement from its own currency.
      const foreign =
        whole.some((row) => row.currency !== currency) || out.some((o) => o.currency !== currency);
      let converted = NOTHING_PAID;
      for (const day of foreign ? daysOf(period.start, period.end) : []) {
        const dayRows = own(await deps.sums.consumptionByCurrency(rowsIn, day, day)).filter(
          (row) => row.currency !== currency,
        );
        const dayOut = (await deps.sums.cashOut(rowsIn, day, day)).filter((o) => o.currency !== currency);
        for (const from of new Set([...dayRows, ...dayOut].map((x) => x.currency))) {
          const rowsFrom = dayRows.filter((row) => row.currency === from);
          const outFrom = withoutCurrency(dayOut.find((o) => o.currency === from));
          if (rowsFrom.length === 0 && !paidSomething(outFrom)) continue;
          if ((await converter.rateOn(from, day)) === null) {
            apart(place, from);
            continue;
          }
          // Every amount of the day in `from` converts, or they are all left out and the space named: never a 0.
          const to = (minor: bigint) => converter.convert(minor, from, day);
          const rowsTo = await Promise.all(
            rowsFrom.map(async (row) => ({ ...row, amount: await to(row.amount) })),
          );
          const outIn = {
            payments: await to(outFrom.payments),
            paymentsOutsideTheApp: await to(outFrom.paymentsOutsideTheApp),
            fundContributions: await to(outFrom.fundContributions),
            contributionsOutsideTheApp: await to(outFrom.contributionsOutsideTheApp),
          };
          if (rowsTo.some((row) => row.amount === null) || Object.values(outIn).some((v) => v === null)) {
            apart(place, from);
            continue;
          }
          for (const row of rowsTo) rows.push(rowOf({ ...row, amount: row.amount! }));
          converted = addPaid(converted, outIn as PaidOut);
        }
      }
      paid = addPaid(paid, converted);
      figures.set(place.spaceId, paid);
      paidOut = addPaid(paidOut, converted);
    }

    // The personal space's categories name the merged groups, even without consumption there (ruling P76).
    const spaceIds = [...new Set<string>([personal.spaceId, ...rows.map((row) => row.spaceId)])];
    const listed = await Promise.all(
      spaceIds.map(async (spaceId) =>
        (await deps.catalog.listCategories(spaceId)).map((c) => ({ ...c, spaceId })),
      ),
    );
    const categories = listed.flat();
    const spaceNames = new Map(allPlaces.map((p) => [p.spaceId as string, p.spaceName]));
    const savings = await deps.savingsAccountsOf(userId);
    const savingsTransfers = await savingsInto(deps, savings, period, personal.currency, currency, converter);
    if (savingsTransfers === null) apart(personal, personal.currency);
    const bySpace = spacesOf.map((place): SpaceFigures => {
      const out = figures.get(place.spaceId) ?? NOTHING_PAID;
      return {
        space: { id: place.spaceId, name: place.spaceName, kind: place.spaceKind, color: place.color },
        consumed: rows.filter((r) => r.spaceId === place.spaceId).reduce((sum, r) => sum + r.amount, 0n),
        paid: out.payments + out.fundContributions,
        ...(place.spaceId === personal.spaceId
          ? { categories: personalCategories(rows, categories, personal.spaceId) }
          : {}),
      };
    });
    return ok({
      currency,
      period,
      consumption: {
        total: rows.reduce((sum, row) => sum + row.amount, 0n),
        groups: consumptionGroups(rows, categories, { personalSpaceId: personal.spaceId, spaceNames }).map(
          (g) => ({
            key: g.key,
            name: g.name,
            space: g.spaceId === null ? null : { id: g.spaceId, name: spaceNames.get(g.spaceId) ?? "" },
            category: g.categoryId === null ? null : { id: g.categoryId, name: g.name },
            amount: g.amount,
            spaces: g.spaceIds.map((id) => ({ id, name: spaceNames.get(id) ?? "" })),
          }),
        ),
      },
      cashOut: cashOutOf(paidOut, savingsTransfers ?? 0n),
      bySpace: bySpace.filter((s) => s.space.id === personal.spaceId || s.consumed !== 0n || s.paid !== 0n),
      otherCurrencySpaces: [...unconverted.values()],
      converted: converter.converted,
      stale: converter.stale,
    });
  };

/**
 * Spec 5.4: what went into the caller's savings accounts in the period. They are in the personal space, so their
 * transfers are in its currency; in another display currency they convert day by day. Null when a day had no rate.
 */
const savingsInto = async (
  deps: PersonalDeps,
  savings: readonly string[],
  period: Period,
  from: string,
  currency: string,
  converter: ReturnType<typeof converterInto>,
): Promise<bigint | null> => {
  if (savings.length === 0) return 0n;
  const sum = (list: readonly { readonly amount: bigint }[]) =>
    list.reduce((total, t) => total + t.amount, 0n);
  // Ruling P342 (S7): counted in the personal space's currency, as a SAVINGS line counts them, then converted.
  const whole = sum(await deps.spending.transfersIntoAccounts(savings, period.start, period.end, from));
  if (from === currency || whole === 0n) return whole;
  let total = 0n;
  let missing = false;
  for (const day of daysOf(period.start, period.end)) {
    const amount = sum(await deps.spending.transfersIntoAccounts(savings, day, day, from));
    if (amount === 0n) continue;
    const value = await converter.convert(amount, from, day);
    if (value === null) missing = true;
    else total += value;
  }
  return missing ? null : total;
};
