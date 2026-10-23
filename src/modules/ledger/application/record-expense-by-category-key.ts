import { domainError, err, type Result } from "@/shared/kernel";
import { authorizeWriter } from "./checks";
import type { LedgerDeps } from "./deps";
import type { LedgerCategory } from "./ports";
import type { RecordedExpense, RecordExpense, RecordExpenseInput } from "./record-expense";

/** Categories by their catalog key (D11); bound to the categories module by the composition root. */
export interface CategoryKeyReader {
  /**
   * The category of the space seeded with `key`, archived ones included; null when there is none or it was
   * deleted logically (Task 0a).
   */
  findByKey(spaceId: string, key: string): Promise<LedgerCategory | null>;
}

export type RecordExpenseByCategoryKeyInput = Omit<RecordExpenseInput, "categoryId"> & {
  readonly categoryKey: string;
};

export type RecordExpenseByCategoryKey = (
  input: RecordExpenseByCategoryKeyInput,
) => Promise<Result<RecordedExpense>>;

/**
 * HU-E1-13: records an expense whose category is named by its catalog key (D11), as a direct split does in
 * a direct space whose category ids the client cannot know yet. The writer is authorized before any
 * category is looked up, so non-members still get SpaceNotFound (spec 8).
 */
export const createRecordExpenseByCategoryKey =
  (
    deps: Pick<LedgerDeps, "access" | "spaceLocks"> & { readonly categoryKeys: CategoryKeyReader },
    recordExpense: RecordExpense,
  ): RecordExpenseByCategoryKey =>
  async ({ categoryKey, ...input }) => {
    const writer = await authorizeWriter(deps, input.spaceId, input.userId);
    if (!writer.ok) return writer;
    const category = await deps.categoryKeys.findByKey(writer.value.spaceId, categoryKey);
    if (category === null) return err(domainError("CategoryNotFound"));
    return recordExpense({ ...input, categoryId: category.id });
  };
