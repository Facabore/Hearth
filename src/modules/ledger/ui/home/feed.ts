import type { PaletteKey } from "@/shared/kernel/style";
import type { ActivityItemDto, MoneyDto, TransactionDto, UnifiedViewDto } from "@/shared/ui/api/dto";

/** Ruling P306: a row of the personal Inicio's Recientes, the person's own or one of a shared or direct space. */
export type FeedEntry =
  | { readonly kind: "own"; readonly tx: TransactionDto }
  | { readonly kind: "group"; readonly item: ActivityItemDto };

/** Ruling P319: an item of the personal Movimientos, her own when it is her personal space's, else her space's. */
export const entryOf = (item: ActivityItemDto): FeedEntry =>
  item.space.kind === "PERSONAL" ? { kind: "own", tx: item.transaction } : { kind: "group", item };

/** The date a row is listed under. */
export const dateOf = (entry: FeedEntry): string =>
  entry.kind === "own" ? entry.tx.date : entry.item.transaction.date;

/** Ruling P306: one part of the month, "Solo tú" (her categories) or "Con otros" (her groups). */
export interface MonthPart {
  readonly amount: MoneyDto;
  readonly items: readonly {
    readonly id: string;
    readonly name: string;
    /** The category's or the space's color; null for a category without one. */
    readonly color: PaletteKey | null;
    readonly amount: MoneyDto;
  }[];
}

/**
 * Ruling P306 (boards "Inicio personal · solo tú y con otros"): the person's month across her spaces. What she spent
 * alone (her personal space, by category) and her part of what she shared (by group); the two add up to `consumed`.
 */
export interface UnifiedMonth {
  readonly consumed: MoneyDto;
  readonly solo: MonthPart;
  readonly withOthers: MonthPart;
}

/** Movimientos' order (ruling P43): the date, then the time (none sorts last within its day), creation, id. */
const positionOf = (tx: TransactionDto) => [tx.date, tx.occurredAt ?? "", tx.createdAt, tx.id] as const;

const newerFirst = (a: TransactionDto, b: TransactionDto): number => {
  const [x, y] = [positionOf(a), positionOf(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? 1 : -1;
  return 0;
};

/**
 * Ruling P306: the personal Inicio's Recientes, the person's own rows and her shared and direct spaces' merged in
 * Movimientos' order, the first `limit`. Both lists come newest first, each holding at least `limit` rows when there are
 * that many, so the first `limit` of the merge are the newest of all.
 */
export const mergedFeed = (
  own: readonly TransactionDto[],
  activity: readonly ActivityItemDto[],
  limit: number,
): FeedEntry[] =>
  [
    ...own.map((tx): FeedEntry => ({ kind: "own", tx })),
    ...activity.map((item): FeedEntry => ({ kind: "group", item })),
  ]
    .sort((a, b) =>
      newerFirst(a.kind === "own" ? a.tx : a.item.transaction, b.kind === "own" ? b.tx : b.item.transaction),
    )
    .slice(0, limit);

const sum = (amounts: readonly MoneyDto[], currency: string): MoneyDto => ({
  amount: amounts.reduce((total, money) => total + BigInt(money.amount), 0n).toString(),
  currency,
});

/**
 * Ruling P306: Inicio's month from the unified view. "Solo tú" is the personal space's consumption by category, "Con
 * otros" each other space where she consumed something. An API without `bySpace` breaks nothing down: everything is
 * hers alone, as the plain home counted it.
 */
export const unifiedMonthOf = (view: UnifiedViewDto): UnifiedMonth => {
  const bySpace = view.bySpace ?? [];
  const personal = bySpace.find((s) => s.space.kind === "PERSONAL");
  const groups = bySpace.filter((s) => s.space.kind !== "PERSONAL" && BigInt(s.consumed.amount) !== 0n);
  const zero = { amount: "0", currency: view.currency };
  return {
    consumed: view.consumption.total,
    solo: {
      amount: personal?.consumed ?? (bySpace.length === 0 ? view.consumption.total : zero),
      items: (personal?.categories ?? []).map((c) => ({ ...c })),
    },
    withOthers: {
      amount: sum(
        groups.map((g) => g.consumed),
        view.currency,
      ),
      items: groups.map((g) => ({
        id: g.space.id,
        name: g.space.name,
        color: g.space.color,
        amount: g.consumed,
      })),
    },
  };
};
