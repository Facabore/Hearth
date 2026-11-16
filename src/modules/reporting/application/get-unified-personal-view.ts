import type { MemberPlace } from "@/modules/spaces/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import type { PaletteKey } from "@/shared/kernel/style";
import { cashOutOf, consumptionGroups, type CashOut } from "../domain/unified-view";
import { converterInto, daysOf } from "./conversion";
import { personalScope, type PersonalDeps } from "./personal-scope";

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

/** Spec 5.4: what one set of member rows paid out, as `PersonalSums.cashOut` answers it. */
type PaidOut = Awaited<ReturnType<PersonalDeps["sums"]["cashOut"]>>;
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

/**
 * HU-E7-04, spec 5.4, D11: everything the caller consumed in a personal period (their shares in every space they are
 * or were a member of, the history of a claimed guest place included) and their cash out, computed on read (D7).
 *
 * D29, slice MC4 (design §4.1): every amount is in the caller's display currency (their personal space's unless they
 * chose one). A space in another currency is read day by day and each day's figures convert at that day's rate,
 * through `Money.convert`; a day with no rate is left out of every sum and its space named in `otherCurrencySpaces`,
 * never counted at 1:1. This ends ruling P37's "other currencies apart".
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
    const inCurrency = allPlaces.filter((p) => p.currency === currency);
    const unconverted = new Map<string, { spaceId: string; name: string; currency: string }>();
    const apart = (p: MemberPlace) =>
      unconverted.set(p.spaceId, { spaceId: p.spaceId, name: p.spaceName, currency: p.currency });

    // The spaces already in the display currency: one read for their consumption, as before.
    const rows: Row[] =
      inCurrency.length === 0
        ? []
        : (
            await deps.sums.consumptionByCategory(
              inCurrency.map((p) => p.memberId),
              period.start,
              period.end,
            )
          ).filter((row) => inCurrency.some((p) => p.spaceId === row.spaceId));
    // Ruling P306: one read per space, over every member row of the caller there (a former one included).
    // The personal space first, even when a claimed guest place is older than the person's sign-up; then the others.
    const spacesOf = [...new Map(allPlaces.map((p) => [p.spaceId as string, p])).values()].sort(
      (a, b) => Number(b.spaceId === personal.spaceId) - Number(a.spaceId === personal.spaceId),
    );
    // What the caller paid out in those spaces, in one read too; each space's own part is read below (ruling P306).
    let paidOut =
      inCurrency.length === 0
        ? NOTHING_PAID
        : await deps.sums.cashOut(
            inCurrency.map((p) => p.memberId),
            period.start,
            period.end,
          );
    const figures = new Map<string, PaidOut>();
    for (const place of spacesOf) {
      const rowsIn = allPlaces.filter((p) => p.spaceId === place.spaceId).map((p) => p.memberId);
      const out = await deps.sums.cashOut(rowsIn, period.start, period.end);
      if (place.currency === currency) {
        figures.set(place.spaceId, out);
        continue;
      }
      // D29 (MC4): another currency. Nothing to convert unless the period holds something; then day by day.
      const own = (list: readonly Row[]) => list.filter((row) => row.spaceId === place.spaceId);
      const whole = own(await deps.sums.consumptionByCategory(rowsIn, period.start, period.end));
      let paid = NOTHING_PAID;
      if (whole.length > 0 || paidSomething(out)) {
        for (const day of daysOf(period.start, period.end)) {
          const dayRows = own(await deps.sums.consumptionByCategory(rowsIn, day, day));
          const dayOut = await deps.sums.cashOut(rowsIn, day, day);
          if (dayRows.length === 0 && !paidSomething(dayOut)) continue;
          if ((await converter.rateOn(place.currency, day)) === null) {
            apart(place);
            continue;
          }
          const to = async (minor: bigint) => (await converter.convert(minor, place.currency, day)) ?? 0n;
          for (const row of dayRows) rows.push({ ...row, amount: await to(row.amount) });
          paid = addPaid(paid, {
            payments: await to(dayOut.payments),
            paymentsOutsideTheApp: await to(dayOut.paymentsOutsideTheApp),
            fundContributions: await to(dayOut.fundContributions),
            contributionsOutsideTheApp: await to(dayOut.contributionsOutsideTheApp),
          });
        }
      }
      figures.set(place.spaceId, paid);
      paidOut = addPaid(paidOut, paid);
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
    if (savingsTransfers === null) apart(personal);
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
  const whole = sum(await deps.spending.transfersIntoAccounts(savings, period.start, period.end));
  if (from === currency || whole === 0n) return whole;
  let total = 0n;
  let missing = false;
  for (const day of daysOf(period.start, period.end)) {
    const amount = sum(await deps.spending.transfersIntoAccounts(savings, day, day));
    if (amount === 0n) continue;
    const value = await converter.convert(amount, from, day);
    if (value === null) missing = true;
    else total += value;
  }
  return missing ? null : total;
};
