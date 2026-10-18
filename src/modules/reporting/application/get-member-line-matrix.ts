import {
  lineForCategory,
  ownedByRegisteredMember,
  rolledUpCategory,
  type AllocationRule,
  type BudgetLine,
  type Funding,
} from "@/modules/budgeting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { matrixRow, type MatrixCell, type MatrixReason } from "../domain/member-matrix";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

export interface MatrixLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly rule: AllocationRule;
  readonly reason: MatrixReason | null;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly MatrixCell[];
}

export interface MemberLineMatrix {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan (ruling P35). */
  readonly lines: readonly MatrixLine[];
}

export type GetMemberLineMatrix = (input: SpaceReportInput) => Promise<Result<MemberLineMatrix>>;

/**
 * Spec 5.4 SAVINGS contribution (rulings P8, P35): what reached each account the line names that a current
 * registered member owns, credited to that owner, who is the one who transferred (HU-E4-03).
 */
const savingsByMember = async (
  deps: MemberSumsDeps,
  members: readonly SpaceMember[],
  line: BudgetLine,
  period: Period,
): Promise<Map<string, bigint>> => {
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
      : await deps.spending.transfersIntoAccounts(
          counted.map((a) => a.accountId),
          period.start,
          period.end,
        );
  const byMember = new Map<string, bigint>();
  for (const transfer of transfers) {
    const memberId = counted.find((a) => a.accountId === transfer.accountId)?.memberId;
    if (memberId !== undefined) byMember.set(memberId, (byMember.get(memberId) ?? 0n) + transfer.amount);
  }
  return byMember;
};

/**
 * HU-E7-02, spec 5.4: assigned, contributed, consumed and gap per current member and line of the period's plan,
 * each expense attributed to the line its category consumes (HU-E6-04), computed on read (D7, ruling P35).
 */
export const createGetMemberLineMatrix =
  (deps: MemberSumsDeps): GetMemberLineMatrix =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    if (view === null) return ok({ ...base, lines: [] });
    const members = await deps.members.listCurrent(space.spaceId);
    const figures = view.figures.lines;
    const parts = {
      lines: figures.map((f) => f.line),
      mappings: figures.flatMap((f) =>
        f.categoryIds.map((categoryId) => ({ lineId: f.line.id, categoryId })),
      ),
    };
    const categories = await deps.categories.list(space.spaceId);
    const sums = new Map<string, { paid: bigint; consumed: bigint }>();
    for (const row of await deps.sums.memberSumsByCategory(space.spaceId, period.start, period.end)) {
      // HU-E3-04: a subcategory's payments and shares count on the line its category consumes, as its spending does.
      const lineId = lineForCategory(rolledUpCategory(row.categoryId, categories), parts);
      if (lineId === null) continue;
      const key = `${lineId}/${row.memberId}`;
      const sum = sums.get(key) ?? { paid: 0n, consumed: 0n };
      sums.set(key, { paid: sum.paid + row.paid, consumed: sum.consumed + row.consumed });
    }
    const lines = await Promise.all(
      figures.map(async ({ line, allocation }): Promise<MatrixLine> => {
        const savings =
          line.funding === "SAVINGS" ? await savingsByMember(deps, members, line, period) : null;
        const row = matrixRow({
          funding: line.funding,
          allocated: allocation.rule !== "NONE",
          invalid: allocation.invalid,
          members: members.map((m) => {
            const sum = sums.get(`${line.id}/${m.id}`);
            return {
              memberId: m.id,
              assigned: allocation.members.find((a) => a.memberId === m.id)?.assigned ?? null,
              contributed: savings === null ? (sum?.paid ?? 0n) : (savings.get(m.id) ?? 0n),
              consumed: sum?.consumed ?? 0n,
            };
          }),
        });
        return { lineId: line.id, name: line.name, funding: line.funding, rule: allocation.rule, ...row };
      }),
    );
    return ok({ ...base, lines });
  };
