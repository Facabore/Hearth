import { authorizeSpaceAction } from "@/modules/spaces/application";
import { ok, periodByLabel, resolvePeriod, todayIn, type Period, type Result } from "@/shared/kernel";
import type { Transaction, TransactionType } from "../domain/transaction";
import type { LedgerDeps } from "./deps";
import type { TransactionFilter, TransactionPosition } from "./ports";

export interface ListTransactionsInput {
  readonly spaceId: string;
  readonly userId: string;
  /** A period label such as "2026-10" or "2026-11 H1"; the current period when absent. */
  readonly period?: string;
  readonly categoryIds?: readonly string[];
  readonly payerMemberId?: string;
  readonly participantMemberId?: string;
  readonly type?: TransactionType;
  readonly after: TransactionPosition | null;
  readonly limit: number;
}

export interface TransactionPage {
  readonly period: Period;
  readonly currency: string;
  readonly totals: { readonly expenses: bigint; readonly income: bigint };
  readonly items: readonly Transaction[];
  readonly nextPosition: TransactionPosition | null;
}

export type ListTransactions = (input: ListTransactionsInput) => Promise<Result<TransactionPage>>;

/** HU-E4-04/05, the M1 monthly view: one period, filtered, newest first, with period totals. */
export const createListTransactions =
  (deps: LedgerDeps): ListTransactions =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const space = membership.value;
    const stored = await deps.storedPeriods(space.spaceId);
    const period =
      input.period === undefined
        ? ok(resolvePeriod(space.periodPolicy, stored, todayIn(deps.clock, deps.timeZone)))
        : periodByLabel(space.periodPolicy, stored, input.period);
    if (!period.ok) return period;
    const filter: TransactionFilter = {
      spaceId: space.spaceId,
      from: period.value.start,
      to: period.value.end,
      categoryIds: input.categoryIds,
      payerMemberId: input.payerMemberId,
      participantMemberId: input.participantMemberId,
      type: input.type,
    };
    // One extra row tells whether another page exists.
    const rows = await deps.query.list(filter, input.after, input.limit + 1);
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return ok({
      period: period.value,
      currency: space.currency,
      totals: await deps.query.totals(filter),
      items,
      nextPosition: rows.length > input.limit && last ? positionOf(last) : null,
    });
  };

/** Ruling P43: where `tx` stands in the list order, for the next page's cursor. */
export const positionOf = (tx: Transaction): TransactionPosition => ({
  date: tx.date,
  occurredAt: tx.occurredAt,
  createdAt: tx.createdAt,
  id: tx.id,
});
