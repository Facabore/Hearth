/** What a user consumed in one category of one space (spec 5.4: their shares). */
export interface CategoryConsumption {
  readonly spaceId: string;
  readonly categoryId: string;
  readonly amount: bigint;
}

/** A live category of one of the user's spaces, as the unified view places and names it (D11, HU-E3-04). */
export interface ConsumptionCategory {
  readonly spaceId: string;
  readonly id: string;
  /** The seeded category's catalog key; null for categories users create. A seeded category moved under another keeps its key, and its consumption rolls up into its parent first. */
  readonly key: string | null;
  readonly name: string;
  /** HU-E3-04: the category a subcategory belongs to; null for a category directly in its group. */
  readonly parentCategoryId: string | null;
}

/** D11: a catalog key groups seeded categories of every space; a custom category (key null) stays its own. */
export interface ConsumptionGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (P76); a custom one's own. */
  readonly name: string;
  /** The custom category and its space; null under a catalog key. */
  readonly spaceId: string | null;
  readonly categoryId: string | null;
  readonly amount: bigint;
}

/** Who names a merged group: the caller's personal space, else the space spending most in it (ruling P76). */
export interface ConsumptionNaming {
  readonly personalSpaceId: string;
  readonly spaceNames: ReadonlyMap<string, string>;
}

interface Group {
  readonly key: string | null;
  readonly spaceId: string | null;
  readonly categoryId: string | null;
  amount: bigint;
  /** What each space spent in the group, and the name the group's category has there. */
  readonly parts: Map<string, { readonly name: string; amount: bigint }>;
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Case ignored, accents not, as `ListCategories` sorts names (ruling P82). */
export const compareText = (a: string, b: string): number =>
  a.localeCompare(b, "es", { sensitivity: "accent" });

/**
 * Rulings P76, P106: the space part that names a merged row the personal space does not name: the most spending,
 * ties by space name (`compareText`), then space id. Every personal report names its merged rows with it.
 */
export const namingPart = <P extends { readonly amount: bigint }>(
  parts: ReadonlyMap<string, P>,
  spaceName: (spaceId: string) => string,
): P =>
  [...parts.entries()].sort(([a, x], [b, y]) =>
    x.amount !== y.amount
      ? x.amount > y.amount
        ? -1
        : 1
      : compareText(spaceName(a), spaceName(b)) || ordinal(a, b),
  )[0]![1];

/**
 * HU-E7-04, spec 5.4, D11: consumption by catalog key, or by space and category for custom categories; a
 * subcategory's consumption counts in its parent category (HU-E3-04: under the parent's key, or as the parent's custom
 * row). The largest group first; on equal amounts by internal group id, so custom rows come before key groups, each in
 * ordinal order (ruling P37).
 */
export const consumptionGroups = (
  rows: readonly CategoryConsumption[],
  categories: readonly ConsumptionCategory[],
  naming: ConsumptionNaming,
): ConsumptionGroup[] => {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const own = byId.get(row.categoryId);
    // A subcategory whose parent is not listed counts as a category of its own (ruling P48 keeps such a parent).
    const parentId = own?.parentCategoryId ?? null;
    const category = (parentId === null ? undefined : byId.get(parentId)) ?? own;
    const categoryId = category?.id ?? row.categoryId;
    const key = category?.key ?? null;
    const id = key === null ? `custom/${row.spaceId}/${categoryId}` : `key/${key}`;
    const group = groups.get(id) ?? {
      key,
      spaceId: key === null ? row.spaceId : null,
      categoryId: key === null ? categoryId : null,
      amount: 0n,
      parts: new Map(),
    };
    group.amount += row.amount;
    const part = group.parts.get(row.spaceId) ?? { name: category?.name ?? "", amount: 0n };
    part.amount += row.amount;
    group.parts.set(row.spaceId, part);
    groups.set(id, group);
  }
  // Ruling P76: a merged group takes the name its key has in the personal space, even without consumption there.
  const personalNames = new Map(
    categories.flatMap((c) =>
      c.spaceId === naming.personalSpaceId && c.key !== null && c.parentCategoryId === null
        ? [[c.key, c.name]]
        : [],
    ),
  );
  const spaceName = (spaceId: string) => naming.spaceNames.get(spaceId) ?? "";
  const nameOf = (group: Group): string =>
    (group.key === null ? undefined : personalNames.get(group.key)) ??
    namingPart(group.parts, spaceName).name;
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => (x.amount !== y.amount ? (x.amount > y.amount ? -1 : 1) : ordinal(a, b)))
    .map(([, group]) => ({
      key: group.key,
      name: nameOf(group),
      spaceId: group.spaceId,
      categoryId: group.categoryId,
      amount: group.amount,
    }));
};

/** Spec 5.4: payments + fund contributions + savings transfers; `outsideTheApp` is the part without an account. */
export interface CashOut {
  readonly total: bigint;
  readonly payments: bigint;
  readonly fundContributions: bigint;
  readonly savingsTransfers: bigint;
  readonly outsideTheApp: bigint;
}

export const cashOutOf = (
  sums: {
    readonly payments: bigint;
    readonly paymentsOutsideTheApp: bigint;
    readonly fundContributions: bigint;
    readonly contributionsOutsideTheApp: bigint;
  },
  savingsTransfers: bigint,
): CashOut => ({
  total: sums.payments + sums.fundContributions + savingsTransfers,
  payments: sums.payments,
  fundContributions: sums.fundContributions,
  savingsTransfers,
  outsideTheApp: sums.paymentsOutsideTheApp + sums.contributionsOutsideTheApp,
});
