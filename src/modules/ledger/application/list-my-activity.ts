import type { Category, CategoryStyle } from "@/modules/categories/application";
import type { MemberPlaceRepository, SpaceRepository, SpaceSummary } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
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
 * Ruling P306: the live transactions of `spaceIds` dated `from` or later (and `to` or earlier, ruling P310, when given),
 * newest first as Movimientos orders them.
 */
export interface RecentTransactions {
  recentIn(
    spaceIds: readonly string[],
    from: LocalDate,
    limit: number,
    to?: LocalDate,
  ): Promise<Transaction[]>;
}

/** The categories of a space, archived ones included (D8: deleted ones answer as missing). */
export interface ActivityCategories {
  listCategories(spaceId: string): Promise<readonly Category[]>;
}

export interface MyActivityDeps {
  /** The caller's current spaces, archived ones left out. */
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  /** The caller's member rows, former ones and a claimed guest's included: what is theirs in each space. */
  readonly places: MemberPlaceRepository;
  readonly members: MemberNames;
  readonly recent: RecentTransactions;
  readonly categories: ActivityCategories;
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

export type ListMyActivity = (input: {
  readonly userId: string;
  readonly from: LocalDate;
  /** Ruling P310: the last date listed, a past period's end. */
  readonly to?: LocalDate;
  readonly limit: number;
}) => Promise<Result<readonly ActivityItem[]>>;

export const MAX_ACTIVITY = 50;

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
  if (tx.type === "SETTLEMENT") return [tx.payerMemberId, tx.receivingMemberId];
  return tx.payerMemberId ? [tx.payerMemberId] : [];
};

/**
 * Ruling P306 (#268): what happened lately in the caller's shared and direct spaces, for the personal Inicio's feed.
 * Only spaces the caller currently belongs to, never a personal one (theirs is read as Movimientos reads it, and no one
 * else's is ever reachable), newest first, from `from`. Each movement says its space, who recorded it, and the caller's
 * part of it.
 */
export const createListMyActivity =
  (deps: MyActivityDeps): ListMyActivity =>
  async ({ userId, from, to, limit }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY)
      return err(domainError("InvalidActivityLimit", { max: MAX_ACTIVITY }));
    // Ruling P310: a range that ends before it starts holds nothing.
    if (to !== undefined && to < from) return ok([]);
    const spaces = (await deps.spaces.listForUser(userId)).filter((s) => s.kind !== "PERSONAL");
    if (spaces.length === 0) return ok([]);
    const spaceIds = spaces.map((s) => s.id);
    const transactions = await deps.recent.recentIn(spaceIds, from, limit, to);
    if (transactions.length === 0) return ok([]);
    const touched = [...new Set(transactions.map((tx) => tx.spaceId))];
    const [places, rows, categories] = await Promise.all([
      deps.places.placesOf(userId),
      deps.members.namesIn(touched),
      Promise.all(touched.map(async (id) => [id, await deps.categories.listCategories(id)] as const)),
    ]);
    const byId = new Map(spaces.map((s) => [s.id, s]));
    const mineIn = (spaceId: string) =>
      new Set(places.filter((p) => p.spaceId === spaceId).map((p) => p.memberId as string));
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
    return ok(
      transactions.flatMap((tx): ActivityItem[] => {
        const space = byId.get(tx.spaceId);
        if (!space) return [];
        const mine = mineIn(tx.spaceId);
        return [
          {
            space: { id: space.id, name: space.name, kind: space.kind, color: space.color },
            transaction: tx,
            recordedBy: { name: recorderIn(tx.spaceId, tx.createdBy), you: tx.createdBy === userId },
            you: {
              memberIds: [...mine],
              share: tx.type === "EXPENSE" ? sumOf(tx.shares, mine) : null,
              paid: tx.type === "EXPENSE" ? sumOf(tx.payments, mine) : null,
            },
            memberNames: Object.fromEntries(
              namedMembers(tx).flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : [])),
            ),
            category: categoryOf(tx),
          },
        ];
      }),
    );
  };
