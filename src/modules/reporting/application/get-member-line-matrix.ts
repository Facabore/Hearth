import {
  lineForCategory,
  ownedByRegisteredMember,
  planViewCache,
  requestReadsOf,
  rolledUpCategory,
  viewReadsOf,
  type ChainReads,
  type AllocationRule,
  type BudgetLine,
  type Funding,
} from "@/modules/budgeting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import {
  matrixRow,
  memberTotals,
  type MatrixCell,
  type MatrixReason,
  type MemberTotal,
} from "../domain/member-matrix";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/** Ruling P342 (S7): a line's row in one currency of the line, never converted. */
export interface MatrixBudget {
  readonly currency: string;
  readonly reason: MatrixReason | null;
  readonly members: readonly MatrixCell[];
}

export interface MatrixLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly rule: AllocationRule;
  readonly reason: MatrixReason | null;
  /** Every current member in join order (ruling P7), in the space currency. */
  readonly members: readonly MatrixCell[];
  /** Ruling P342 (S7): the row in every currency of the line, its budgets first. */
  readonly budgets: readonly MatrixBudget[];
}

export interface MemberLineMatrix {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan (ruling P35). */
  readonly lines: readonly MatrixLine[];
  /** #213 (ruling P262): every current member's total gap over the lines, in join order; none without a plan. */
  readonly members: readonly MemberTotal[];
  /** Ruling P342 (S7): every member's total gap per currency, the space currency first; none without a plan. */
  readonly currencies: readonly { readonly currency: string; readonly members: readonly MemberTotal[] }[];
}

export type GetMemberLineMatrix = (input: SpaceReportInput) => Promise<Result<MemberLineMatrix>>;

/**
 * Spec 5.4 SAVINGS contribution (rulings P8, P35): what reached each account the line names that a current
 * registered member owns, credited to that owner, who is the one who transferred (HU-E4-03).
 */
const savingsByMember = async (
  deps: Pick<ChainReads, "savingsAccounts" | "spending">,
  members: readonly SpaceMember[],
  line: BudgetLine,
  period: Period,
): Promise<Map<string, Map<string, bigint>>> => {
  const counts = ownedByRegisteredMember(members);
  const owned = await Promise.all(
    line.savingsAccountIds.map(async (accountId) => {
      const account = await deps.savingsAccounts.find(accountId);
      if (account === null || !counts(account)) return [];
      const owner = members.find((m) => m.userId === account.ownerUserId);
      return owner === undefined ? [] : [{ accountId, memberId: owner.id }];
    }),
  );
  const counted = owned.flat();
  const transfers =
    counted.length === 0
      ? []
      : await deps.spending.transfersIntoAccountsByCurrency(
          counted.map((a) => a.accountId),
          period.start,
          period.end,
        );
  // Ruling P342 (S7): per currency, each transfer in its own.
  const byCurrency = new Map<string, Map<string, bigint>>();
  for (const transfer of transfers) {
    const memberId = counted.find((a) => a.accountId === transfer.accountId)?.memberId;
    if (memberId === undefined) continue;
    const byMember = byCurrency.get(transfer.currency) ?? new Map<string, bigint>();
    byMember.set(memberId, (byMember.get(memberId) ?? 0n) + transfer.amount);
    byCurrency.set(transfer.currency, byMember);
  }
  return byCurrency;
};

/**
 * HU-E7-02, spec 5.4: assigned, contributed, consumed and gap per current member and line of the period's plan,
 * each expense attributed to the line its category consumes (HU-E6-04), computed on read (D7, ruling P35).
 */
export const createGetMemberLineMatrix =
  (deps: MemberSumsDeps): GetMemberLineMatrix =>
  async (input) => {
    const cache = planViewCache();
    const report = await spaceReport(deps, input, cache);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    if (view === null) return ok({ ...base, lines: [], members: [], currencies: [] });
    // The members, categories, accounts and transfers the view was figured from, read once in the request.
    const { members, categories } = await viewReadsOf(deps, space, cache);
    const reads = await requestReadsOf(deps, space, cache);
    const figures = view.figures.lines;
    const parts = {
      lines: figures.map((f) => f.line),
      mappings: figures.flatMap((f) =>
        f.categoryIds.map((categoryId) => ({ lineId: f.line.id, categoryId })),
      ),
    };
    const sums = new Map<string, { paid: bigint; consumed: bigint }>();
    // Ruling P342 (S7, T6): each expense in its own currency, as the plan's lines count it.
    for (const row of await deps.sums.memberSumsByCategoryByCurrency(
      space.spaceId,
      period.start,
      period.end,
    )) {
      // HU-E3-04: a subcategory's payments and shares count on the line its category consumes, as its spending does.
      const lineId = lineForCategory(rolledUpCategory(row.categoryId, categories), parts);
      if (lineId === null) continue;
      const key = `${lineId}/${row.memberId}/${row.currency}`;
      const sum = sums.get(key) ?? { paid: 0n, consumed: 0n };
      sums.set(key, { paid: sum.paid + row.paid, consumed: sum.consumed + row.consumed });
    }
    const lines = await Promise.all(
      figures.map(async ({ line, allocation, budgets }): Promise<MatrixLine> => {
        const savings =
          line.funding === "SAVINGS" ? await savingsByMember(reads, members, line, period) : null;
        /** The row in `currency`, by the assigned amounts and the allocation flag the plan figured in it. */
        const rowIn = (
          currency: string,
          assignment: { readonly members: typeof allocation.members; readonly invalid: boolean },
        ) =>
          matrixRow({
            funding: line.funding,
            allocated: allocation.rule !== "NONE",
            invalid: assignment.invalid,
            members: members.map((m) => {
              const sum = sums.get(`${line.id}/${m.id}/${currency}`);
              return {
                memberId: m.id,
                assigned: assignment.members.find((a) => a.memberId === m.id)?.assigned ?? null,
                contributed: savings === null ? (sum?.paid ?? 0n) : (savings.get(currency)?.get(m.id) ?? 0n),
                consumed: sum?.consumed ?? 0n,
              };
            }),
          });
        // The space currency's row reads the line's scalar figures, as before T6.
        const row = rowIn(space.currency, allocation);
        return {
          lineId: line.id,
          name: line.name,
          funding: line.funding,
          rule: allocation.rule,
          ...row,
          budgets: budgets.map((b) => ({ currency: b.currency, ...rowIn(b.currency, b.allocation) })),
        };
      }),
    );
    const memberIds = members.map((m) => m.id);
    const totals = memberTotals(memberIds, lines);
    const currencies = view.figures.currencies.map((c) => ({
      currency: c.currency,
      members: memberTotals(
        memberIds,
        lines.flatMap((line) => line.budgets.filter((b) => b.currency === c.currency)),
      ),
    }));
    return ok({ ...base, lines, members: totals, currencies });
  };
