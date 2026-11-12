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
  return tx.payerMemberId ? [tx.payerMemberId] : [];
};

/**
 * Rulings P306 and P319: each movement with its space, who recorded it, the caller's part of it, the names of the
 * members it names and its category, in the order given. Inicio's Recientes and the personal Movimientos describe
 * their movements alike through this one function.
 */
export const describeActivity = async (
  deps: ActivityDescriptionDeps,
  { userId, spaces, places, transactions }: ActivityToDescribe,
): Promise<ActivityItem[]> => {
  if (transactions.length === 0) return [];
  const touched = [...new Set(transactions.map((tx) => tx.spaceId))];
  const [mine, rows, categories] = await Promise.all([
    places,
    deps.members.namesIn(touched),
    Promise.all(touched.map(async (id) => [id, await deps.categories.listCategories(id)] as const)),
  ]);
  const byId = new Map(spaces.map((s) => [s.id, s]));
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
        },
        memberNames: Object.fromEntries(
          namedMembers(tx).flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : [])),
        ),
        category: categoryOf(tx),
      },
    ];
  });
};
