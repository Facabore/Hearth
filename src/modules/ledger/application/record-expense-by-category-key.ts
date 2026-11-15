import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import type { SpaceMembership } from "@/modules/spaces/application";
import type { SplitInput } from "../domain/split";
import { authorizeWriter } from "./checks";
import type { LedgerDeps } from "./deps";
import type { LedgerCategory } from "./ports";
import type { RecordedExpense, RecordExpense, RecordExpenseInput } from "./record-expense";

/** Categories by their catalog key (D11); bound to the categories module by the composition root. */
export interface CategoryKeyReader {
  /**
   * The category of the space seeded with `key`, archived ones included; null when there is none or it was
   * deleted logically.
   */
  findByKey(spaceId: string, key: string): Promise<LedgerCategory | null>;
}

/**
 * P331: in a two-member direct space, the recorder's part and the other member's, whose ids the client cannot know
 * before the space exists. A part of zero leaves that member out of the split.
 */
export interface PairShares {
  readonly mine: Money;
  readonly theirs: Money;
}

export type RecordExpenseByCategoryKeyInput = Omit<RecordExpenseInput, "categoryId" | "split"> & {
  readonly categoryKey: string;
  /** P331: the parts of a pair's expense; when absent, the default split (spec 5.3, HU-E6-08). */
  readonly pairShares?: PairShares;
  /**
   * P333 (P168 amended): the other member of a two-member space paid, with their own money and no account; the
   * recorder names no account then.
   */
  readonly paidByOther?: boolean;
};

export type RecordExpenseByCategoryKey = (
  input: RecordExpenseByCategoryKeyInput,
) => Promise<Result<RecordedExpense>>;

/** P331, P333: the other member of a two-member space; anyone else makes it not a pair. */
const otherOf = async (
  deps: Pick<LedgerDeps, "members">,
  space: SpaceMembership,
): Promise<Result<string>> => {
  const others = (await deps.members.listCurrent(space.spaceId)).filter((m) => m.id !== space.memberId);
  return others.length === 1 ? ok(others[0]!.id) : err(domainError("InvalidSplit", { reason: "notAPair" }));
};

/** P331: EXACT parts for the two members, the recorder's first; a part of zero leaves that member out. */
const pairSplit = (me: string, other: string, shares: PairShares): SplitInput => ({
  method: "EXACT",
  participants: [
    { memberId: me, amount: shares.mine },
    { memberId: other, amount: shares.theirs },
  ].filter((p) => !p.amount.isZero()),
});

/**
 * HU-E1-13: records an expense whose category is named by its catalog key (D11), as a direct split does in
 * a direct space whose category ids the client cannot know yet. The writer is authorized before any
 * category or member is looked up, so non-members still get SpaceNotFound (spec 8).
 */
export const createRecordExpenseByCategoryKey =
  (
    deps: Pick<LedgerDeps, "access" | "spaceLocks" | "members"> & {
      readonly categoryKeys: CategoryKeyReader;
    },
    recordExpense: RecordExpense,
  ): RecordExpenseByCategoryKey =>
  async ({ categoryKey, pairShares, paidByOther = false, ...input }) => {
    const writer = await authorizeWriter(deps, input.spaceId, input.userId);
    if (!writer.ok) return writer;
    const category = await deps.categoryKeys.findByKey(writer.value.spaceId, categoryKey);
    if (category === null) return err(domainError("CategoryNotFound"));
    if (pairShares === undefined && !paidByOther) return recordExpense({ ...input, categoryId: category.id });
    const other = await otherOf(deps, writer.value);
    if (!other.ok) return other;
    const { accountId, ...rest } = input;
    return recordExpense({
      ...(paidByOther
        ? { ...rest, payments: [{ memberId: other.value, accountId: null, amount: input.amount }] }
        : { ...rest, ...(accountId === undefined ? {} : { accountId }) }),
      categoryId: category.id,
      ...(pairShares === undefined
        ? {}
        : { split: pairSplit(writer.value.memberId, other.value, pairShares) }),
    });
  };
