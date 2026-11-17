import type { Category, CategoryStyle } from "@/modules/categories/application";
import type { MemberPlace, SpaceSummary } from "@/modules/spaces/application";
import type { Transaction } from "../domain/transaction";

/** Ruling P306: every member row of the given spaces, former ones included, so an old movement still names its people. */
export interface MemberNames {
  namesIn(spaceIds: readonly string[]): Promise<
    readonly {
      readonly memberId: string;
      readonly spaceId: string;
      readonly userId: string | null;
      readonly displayName: string;
      /** Whether the row is current; a person who left and came back has one current row. */
      readonly current: boolean;
    }[]
  >;
}

/**
 * Ruling P339 (S9): what a payment did between its payer and its receiver, by what the payer owed the receiver just
 * before it: paid that debt, lent it all, or both; `paid + lent` is its amount.
 */
export interface SettlementContext {
  readonly kind: "PAID" | "LENT" | "PAID_AND_LENT";
  readonly paid: bigint;
  readonly lent: bigint;
}

/**
 * Ruling P339: the contexts of the payments of each space asked about, by transaction id, computed on read (D7) from
 * the pair's balance in that space; bound by the composition root to the balances module. A payment it does not
 * describe (a forgiveness, a gift, one made for someone else) is missing from the answer.
 */
export interface SettlementContextSource {
  contextOf(
    queries: readonly {
      readonly spaceId: string;
      readonly currency: string;
      readonly settlementIds: readonly string[];
    }[],
  ): Promise<ReadonlyMap<string, SettlementContext>>;
}

/** The categories of a space, archived ones included (D8: deleted ones answer as missing). */
export interface ActivityCategories {
  listCategories(spaceId: string): Promise<readonly Category[]>;
}

export interface ActivityItem {
  readonly space: Pick<SpaceSummary, "id" | "name" | "kind" | "color">;
  readonly transaction: Transaction;
  /** Who recorded it, by their name in the space; `you` when it was the caller. */
  readonly recordedBy: { readonly name: string | null; readonly you: boolean };
  /** The caller's member rows in the space, their share of the movement and what they paid of it. */
  readonly you: {
    readonly memberIds: readonly string[];
    readonly share: bigint | null;
    readonly paid: bigint | null;
    /** Ruling P339: a payment between the caller and someone else, as paid, lent or both; absent otherwise. */
    readonly settlement?: SettlementContext;
  };
  /** The names of the members the movement names (payers, participants, a settlement's two sides). */
  readonly memberNames: Readonly<Record<string, string>>;
  /** Its category as the space shows it: a subcategory under its parent, with the parent's style. */
  readonly category: {
    readonly name: string;
    readonly path: string;
    readonly style: CategoryStyle | null;
  } | null;
}

export interface ActivityDescriptionDeps {
  readonly members: MemberNames;
  readonly categories: ActivityCategories;
  /** Ruling P339: without it, no payment says whether it paid or lent. */
  readonly settlements?: SettlementContextSource;
}

export interface ActivityToDescribe {
  readonly userId: string;
  /** The spaces the movements may belong to; a movement of any other space is left out. */
  readonly spaces: readonly Pick<SpaceSummary, "id" | "name" | "kind" | "color">[];
  /**
   * The caller's member rows, former ones and a claimed guest's included (`MemberPlaceRepository.placesOf`); a pending
   * read is awaited beside the names and categories.
   */
  readonly places: Places | Promise<Places>;
  readonly transactions: readonly Transaction[];
}

type Places = readonly Pick<MemberPlace, "spaceId" | "memberId">[];

const sumOf = (
  parts: readonly { readonly memberId: string | null; readonly amount: bigint }[],
  mine: Set<string>,
) => {
  const owned = parts.filter((part) => part.memberId !== null && mine.has(part.memberId));
  return owned.length === 0 ? null : owned.reduce((sum, part) => sum + part.amount, 0n);
};

const namedMembers = (tx: Transaction): string[] => {
  if (tx.type === "EXPENSE")
    return [
      ...tx.payments.flatMap((p) => (p.memberId ? [p.memberId] : [])),
      ...tx.shares.map((s) => s.memberId),
    ];
  if (tx.type === "INCOME") return [tx.receivingMemberId];
  // Ruling P322: and the member a payment was made for, so the activity can say whose debt it paid.
  if (tx.type === "SETTLEMENT")
    return [
      tx.payerMemberId,
      tx.receivingMemberId,
      ...(tx.onBehalfOfMemberId ? [tx.onBehalfOfMemberId] : []),
    ];
  // Design Q4: an adjustment names nobody; it moves one account.
  if (tx.type === "ADJUSTMENT") return [];
  return tx.payerMemberId ? [tx.payerMemberId] : [];
};

/**
 * Ruling P339 (S9): the contexts of the payments listed that the caller made or received, asked once for all of them,
 * grouped by space; none without a source or without such a payment. A forgiveness, a gift and a payment made for
 * someone else keep their own words, so they are never asked about.
 */
const paymentContexts = async (
  deps: ActivityDescriptionDeps,
  transactions: readonly Transaction[],
  spaces: ReadonlyMap<string, Pick<SpaceSummary, "id">>,
  isYours: (spaceId: string, memberId: string) => boolean,
): Promise<ReadonlyMap<string, SettlementContext>> => {
  const bySpace = new Map<string, { currency: string; settlementIds: string[] }>();
  for (const tx of transactions) {
    if (tx.type !== "SETTLEMENT" || tx.reason !== "PAYMENT" || tx.onBehalfOfMemberId !== null) continue;
    if (!spaces.has(tx.spaceId)) continue;
    if (!isYours(tx.spaceId, tx.payerMemberId) && !isYours(tx.spaceId, tx.receivingMemberId)) continue;
    const space = bySpace.get(tx.spaceId) ?? { currency: tx.currency, settlementIds: [] };
    space.settlementIds.push(tx.id);
    bySpace.set(tx.spaceId, space);
  }
  if (!deps.settlements || bySpace.size === 0) return new Map();
  return deps.settlements.contextOf([...bySpace].map(([spaceId, space]) => ({ spaceId, ...space })));
};

/**
 * Rulings P306 and P319: each movement with its space, who recorded it, the caller's part of it (P339: a payment's
 * context too), the names of the members it names and its category, in the order given. Inicio's Recientes and the
 * personal Movimientos describe their movements alike through this one function.
 */
export const describeActivity = async (
  deps: ActivityDescriptionDeps,
  { userId, spaces, places, transactions }: ActivityToDescribe,
): Promise<ActivityItem[]> => {
  if (transactions.length === 0) return [];
  const touched = [...new Set(transactions.map((tx) => tx.spaceId))];
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const settled = (async () => {
    const yours = await places;
    return paymentContexts(deps, transactions, byId, (spaceId, memberId) =>
      yours.some((p) => p.spaceId === spaceId && p.memberId === memberId),
    );
  })();
  const [mine, rows, categories, contexts] = await Promise.all([
    places,
    deps.members.namesIn(touched),
    Promise.all(touched.map(async (id) => [id, await deps.categories.listCategories(id)] as const)),
    settled,
  ]);
  const mineIn = (spaceId: string) =>
    new Set(mine.filter((p) => p.spaceId === spaceId).map((p) => p.memberId as string));
  const names = new Map(rows.map((r) => [r.memberId, r.displayName]));
  const categoriesOf = new Map(categories);
  const recorderIn = (spaceId: string, recorder: string) => {
    const theirs = rows.filter((r) => r.spaceId === spaceId && r.userId === recorder);
    return (theirs.find((r) => r.current) ?? theirs.at(-1))?.displayName ?? null;
  };
  const categoryOf = (tx: Transaction): ActivityItem["category"] => {
    if (tx.categoryId === null) return null;
    const list = categoriesOf.get(tx.spaceId) ?? [];
    const found = list.find((c) => c.id === tx.categoryId);
    if (!found) return null;
    const parent = found.parentCategoryId ? list.find((c) => c.id === found.parentCategoryId) : undefined;
    return {
      name: found.name,
      path: parent ? `${parent.name} › ${found.name}` : found.name,
      style: found.style ?? parent?.style ?? null,
    };
  };
  return transactions.flatMap((tx): ActivityItem[] => {
    const space = byId.get(tx.spaceId);
    if (!space) return [];
    const yours = mineIn(tx.spaceId);
    return [
      {
        space: { id: space.id, name: space.name, kind: space.kind, color: space.color },
        transaction: tx,
        recordedBy: { name: recorderIn(tx.spaceId, tx.createdBy), you: tx.createdBy === userId },
        you: {
          memberIds: [...yours],
          share: tx.type === "EXPENSE" ? sumOf(tx.shares, yours) : null,
          paid: tx.type === "EXPENSE" ? sumOf(tx.payments, yours) : null,
          ...(contexts.has(tx.id) ? { settlement: contexts.get(tx.id)! } : {}),
        },
        memberNames: Object.fromEntries(
          namedMembers(tx).flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : [])),
        ),
        category: categoryOf(tx),
      },
    ];
  });
};
