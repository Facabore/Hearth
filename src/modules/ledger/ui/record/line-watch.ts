import { lineStateOf, type LineState } from "@/shared/kernel/line-state";
import type { LineDashboardDto, MoneyDto } from "@/shared/ui/api/dto";

type DashLine = LineDashboardDto["lines"][number];

/** Ruling P236 (M6c): the lines the record form checks an expense against, by category, for one period. */
export interface LineWatch {
  readonly startDate: string;
  readonly endDate: string;
  readonly currency: string;
  readonly lineOf: Readonly<Record<string, DashLine>>;
}

/** Ruling P236: only an ACTIVE plan is checked; SAVINGS lines consume transfers, never expenses (spec 5.4). */
export const lineWatchOf = (dashboard: LineDashboardDto): LineWatch | null => {
  if (dashboard.plan?.status !== "ACTIVE") return null;
  const byId = new Map(dashboard.lines.map((line) => [line.lineId, line]));
  const lineOf: Record<string, DashLine> = {};
  for (const { categoryId, lineId } of dashboard.categoryLines) {
    const line = lineId === null ? undefined : byId.get(lineId);
    if (line !== undefined && line.funding !== "SAVINGS") lineOf[categoryId] = line;
  }
  return {
    startDate: dashboard.period.startDate,
    endDate: dashboard.period.endDate,
    currency: dashboard.totals.planned.currency,
    lineOf,
  };
};

export type LineLevel = Exclude<LineState, "OK">;

export interface LineWarning {
  readonly level: LineLevel;
  readonly line: string;
  /** The whole percent of the line's budget used after the expense, rounded down ("94"); null when OVER (#211). */
  readonly used: string | null;
  /** What would be left (NEAR, HIGH) or how much over (OVER), never negative. */
  readonly rest: MoneyDto;
}

/** #211: whole percents, rounded down, so a line short of its plan never reads 100 %. */
const shareText = (used: bigint, budget: bigint): string => String((used * 100n) / budget);

/**
 * #142, ruling P235 (M6c): a labelled preview of the state `amountMinor` would leave its line in; the server's
 * dashboard has the last word. The line's budget is planned + carry-over (HU-E6-09), and after the expense
 * available − amount is left. The levels are the API's own `lineStateOf` (ruling P244), so the form and the
 * dashboard cannot disagree. Integer arithmetic in minor units; the share is a whole percent, rounded down (#211).
 */
export const lineWarningOf = (
  watch: LineWatch | null,
  input: {
    readonly categoryId: string | null;
    /** The parent of a chosen subcategory, whose line a subcategory consumes (HU-E3-04). */
    readonly parentId: string | null;
    readonly amountMinor: string | null;
    readonly date: string;
    readonly currency: string;
  },
): LineWarning | null => {
  if (watch === null || input.categoryId === null || input.amountMinor === null) return null;
  if (input.currency !== watch.currency || input.date < watch.startDate || input.date > watch.endDate)
    return null;
  const line =
    watch.lineOf[input.categoryId] ?? (input.parentId === null ? undefined : watch.lineOf[input.parentId]);
  const amount = BigInt(input.amountMinor);
  if (line === undefined || amount <= 0n) return null;
  const budget = BigInt(line.planned.amount) + BigInt(line.carryOver.amount);
  const after = BigInt(line.available.amount) - amount;
  const money = (minor: bigint): MoneyDto => ({ amount: minor.toString(), currency: watch.currency });
  const state = lineStateOf(budget, after);
  if (state === "OK") return null;
  if (state === "OVER") return { level: "OVER", line: line.name, used: null, rest: money(-after) };
  return { level: state, line: line.name, used: shareText(budget - after, budget), rest: money(after) };
};

/** #211 (amends ruling P235): only an expense that goes over its line asks before saving; NEAR and HIGH are notes. */
export const asksFirst = (warning: LineWarning | null): boolean => warning?.level === "OVER";
