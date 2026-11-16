import type { ListAccounts } from "@/modules/accounts/application";
import type { GetBudgetPlan } from "@/modules/budgeting/application";
import type { ListCategories } from "@/modules/categories/application";
import {
  positionOf,
  type ListRecurrences,
  type MemberNames,
  type RecurrenceView,
  type Transaction,
  type TransactionQuery,
} from "@/modules/ledger/application";
import type { ListMembers, ListMySpaces } from "@/modules/spaces/application";
import { fromParts, ok, type Result } from "@/shared/kernel";
import type { ExportReader } from "../application/export-person-data";
import type { ExportMovementSource, ExportRecurrenceSource } from "../domain/export-source";

/** The other modules' read use cases the export goes through, each authorizing its own read. */
export interface ExportReaderDeps {
  readonly listMySpaces: ListMySpaces;
  readonly listMembers: ListMembers;
  readonly listAccounts: ListAccounts;
  readonly listCategories: ListCategories;
  readonly listRecurrences: ListRecurrences;
  readonly getPlan: GetBudgetPlan;
  /**
   * The ledger's own list query, read for every date after the space was authorized: `ListTransactions` answers one
   * period, and an export needs them all.
   */
  readonly transactions: Pick<TransactionQuery, "list">;
  /**
   * Every member row of the space, former ones included (D15), as the ledger's `MemberNames` port reads them for the
   * activity feed; only called after `listMembers` authorized the read.
   */
  readonly memberNamesIn: MemberNames["namesIn"];
  /** The ids of the space's budget plans, oldest first. */
  readonly planIdsOf: (spaceId: string) => Promise<readonly string[]>;
}

/** Every date a movement may carry (the kernel's dates start in 1900). */
const EVER = { from: fromParts(1900, 1, 1), to: fromParts(9999, 12, 31) };
const PAGE = 500;

const movementOf = (tx: Transaction): ExportMovementSource => {
  const base = {
    id: tx.id,
    type: tx.type,
    date: tx.date,
    occurredAt: tx.occurredAt,
    timeZone: tx.timeZone,
    description: tx.description,
    amount: tx.amount,
    currency: tx.currency,
    payments: [],
    shares: [],
    payerMemberId: null,
    receivingMemberId: null,
    sourceAccountId: null,
    destinationAccountId: null,
    settlementReason: null,
  };
  switch (tx.type) {
    case "EXPENSE":
      return {
        ...base,
        categoryId: tx.categoryId,
        payments: tx.payments.map((p) => ({
          memberId: p.memberId,
          accountId: p.accountId,
          amount: p.amount,
        })),
        shares: tx.shares.map((s) => ({
          memberId: s.memberId,
          amount: s.amount,
          splitMethod: s.splitMethod,
        })),
      };
    case "INCOME":
      return {
        ...base,
        categoryId: tx.categoryId,
        receivingMemberId: tx.receivingMemberId,
        destinationAccountId: tx.destinationAccountId,
      };
    case "TRANSFER":
      return {
        ...base,
        categoryId: null,
        payerMemberId: tx.payerMemberId,
        sourceAccountId: tx.sourceAccountId,
        destinationAccountId: tx.destinationAccountId,
      };
    case "SETTLEMENT":
      return {
        ...base,
        categoryId: null,
        payerMemberId: tx.payerMemberId,
        receivingMemberId: tx.receivingMemberId,
        sourceAccountId: tx.sourceAccountId,
        destinationAccountId: tx.destinationAccountId,
        settlementReason: tx.reason,
      };
    // Design Q4 (#329): a balance adjustment of one account: money in names it as the destination, out as the source.
    case "ADJUSTMENT":
      return {
        ...base,
        categoryId: null,
        sourceAccountId: tx.sourceAccountId,
        destinationAccountId: tx.destinationAccountId,
      };
  }
};

const recurrenceOf = ({ recurrence: r, status, nextOccurrence }: RecurrenceView): ExportRecurrenceSource => {
  const base = {
    id: r.id,
    type: r.template.type,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    mode: r.mode,
    schedule: r.schedule,
    startDate: r.startDate,
    endDate: r.endDate,
    status,
    nextOccurrence,
  };
  const t = r.template;
  switch (t.type) {
    case "EXPENSE":
      return {
        ...base,
        categoryId: t.categoryId,
        payerMemberId: t.payer.memberId,
        sourceAccountId: t.payer.accountId,
        destinationAccountId: null,
      };
    case "INCOME":
      return {
        ...base,
        categoryId: t.categoryId,
        payerMemberId: null,
        sourceAccountId: null,
        destinationAccountId: t.accountId,
      };
    case "TRANSFER":
      return {
        ...base,
        categoryId: null,
        payerMemberId: null,
        sourceAccountId: t.sourceAccountId,
        destinationAccountId: t.destinationAccountId,
      };
    case "FUND_CONTRIBUTION":
      return {
        ...base,
        categoryId: null,
        payerMemberId: t.memberId,
        sourceAccountId: t.sourceAccountId,
        destinationAccountId: t.fundAccountId,
      };
  }
};

const all = async <T, U>(
  results: readonly Promise<Result<T>>[],
  map: (value: T) => U,
): Promise<Result<U[]>> => {
  const values: U[] = [];
  for (const result of await Promise.all(results)) {
    if (!result.ok) return result;
    values.push(map(result.value));
  }
  return ok(values);
};

/** Design §3.6: the export's reads, over the spaces, accounts, categories, ledger and budgeting use cases. */
export const createExportReader = (deps: ExportReaderDeps): ExportReader => ({
  async spacesOf(userId) {
    const [every, active] = await Promise.all([
      deps.listMySpaces(userId, { includeArchived: true }),
      deps.listMySpaces(userId),
    ]);
    if (!every.ok) return every;
    if (!active.ok) return active;
    const live = new Set(active.value.map((s) => s.id));
    return ok(
      every.value.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        currency: s.currency,
        periodPolicy: s.periodPolicy,
        role: s.role,
        archived: !live.has(s.id),
      })),
    );
  },

  async members(spaceId, userId) {
    const members = await deps.listMembers({ spaceId, userId });
    if (!members.ok) return members;
    const current = members.value.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      role: m.role,
      guest: m.kind === "GUEST",
      you: m.userId === userId,
      current: true,
    }));
    const listed = new Set<string>(current.map((m) => m.id));
    // D15: a member who left keeps their row, so the money they moved still carries their name.
    const former = (await deps.memberNamesIn([spaceId]))
      .filter((row) => !listed.has(row.memberId))
      .map((row) => ({
        id: row.memberId,
        displayName: row.displayName,
        role: null,
        guest: row.userId === null,
        you: row.userId === userId,
        current: false,
      }));
    return ok([...current, ...former]);
  },

  async accounts(spaceId, userId) {
    const list = await deps.listAccounts({ spaceId, userId, includeArchived: true });
    if (!list.ok) return list;
    return ok(
      list.value.items.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingBalance: a.openingBalance,
        terms: a.terms,
        archived: a.archivedAt !== null,
      })),
    );
  },

  async categories(spaceId, userId) {
    const groups = await deps.listCategories({ spaceId, userId, includeArchived: true });
    if (!groups.ok) return groups;
    const archived = (row: { archivedAt: Date | null }) => row.archivedAt !== null;
    return ok(
      groups.value.map((g) => ({
        id: g.id,
        name: g.name,
        key: g.key,
        archived: archived(g),
        categories: g.categories.map((c) => ({
          id: c.id,
          name: c.name,
          key: c.key,
          archived: archived(c),
          subcategories: c.subcategories.map((s) => ({
            id: s.id,
            name: s.name,
            key: s.key,
            archived: archived(s),
          })),
        })),
      })),
    );
  },

  // The ledger query below checks nothing, so this read checks the caller's access itself (D9), even though the
  // export also reads `members` first: a caller that skips that step still gets no movement.
  async movements(spaceId, userId) {
    const access = await deps.listMembers({ spaceId, userId });
    if (!access.ok) return access;
    const movements: ExportMovementSource[] = [];
    let after = null;
    for (;;) {
      // The same query and filter `ListTransactions` uses after its `space.read` check: live rows of this space only, no
      // rule by role, guest or VIEWER; a later visibility rule there must be applied here too.
      const page = await deps.transactions.list({ spaceId, ...EVER }, after, PAGE);
      movements.push(...page.map(movementOf));
      const last = page.at(-1);
      if (page.length < PAGE || last === undefined) return ok(movements);
      after = positionOf(last);
    }
  },

  async recurrences(spaceId, userId) {
    const views = await deps.listRecurrences({ spaceId, userId });
    if (!views.ok) return views;
    return ok(views.value.map(recurrenceOf));
  },

  async plans(spaceId, userId) {
    const ids = await deps.planIdsOf(spaceId);
    return all(
      ids.map((planId) => deps.getPlan({ spaceId, userId, planId })),
      ({ plan, currency, figures }) => ({
        id: plan.id,
        period: { label: plan.period.label, start: plan.period.start, end: plan.period.end },
        status: plan.status,
        currency,
        lines: figures.lines.map(({ line, categoryIds }) => ({
          id: line.id,
          name: line.name,
          plannedAmount: line.plannedAmount,
          funding: line.funding,
          rolloverMode: line.rolloverMode,
          isCatchAll: line.isCatchAll,
          allocationRule: line.allocationRule,
          categoryIds,
          payerMemberIds: line.payerMemberIds,
        })),
      }),
    );
  },
});
