import type {
  ActivityItemDto,
  MoneyDto,
  SpaceDto,
  TransactionDto,
  UnifiedViewDto,
} from "@/shared/ui/api/dto";

/** Ruling P306: a row of the personal Inicio's Recientes, the person's own or one of a shared or direct space. */
export type FeedEntry =
  | { readonly kind: "own"; readonly tx: TransactionDto }
  | { readonly kind: "group"; readonly item: ActivityItemDto };

/** Ruling P306: the person's month across her spaces, from the unified view's per-space figures. */
export interface UnifiedMonth {
  /** Her share of everything: the personal spending and her part of each group. */
  readonly consumed: MoneyDto;
  /** What she paid: payments and fund contributions, in every space. */
  readonly paid: MoneyDto;
  readonly bySpace: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: SpaceDto["kind"];
    readonly color: NonNullable<SpaceDto["color"]>;
    readonly consumed: MoneyDto;
    readonly paid: MoneyDto;
  }[];
  /** Mi consumo for the period, where the month is broken down by category. */
  readonly href: string;
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
 * Ruling P306: Inicio's headline from the unified view, her share (the consumption's total) and what she paid (Σ per
 * space, which leaves savings transfers out). An API without `bySpace` breaks nothing down: her share stays the total.
 */
export const unifiedMonthOf = (view: UnifiedViewDto, href: string): UnifiedMonth => {
  const bySpace = (view.bySpace ?? []).map((s) => ({ ...s.space, consumed: s.consumed, paid: s.paid }));
  return {
    consumed: view.consumption.total,
    paid: sum(
      bySpace.map((s) => s.paid),
      view.currency,
    ),
    bySpace,
    href,
  };
};
