import type { FundTrackingDto, MemberMatrixDto, MoneyDto } from "@/shared/ui/api/dto";

type Cell = MemberMatrixDto["lines"][number]["members"][number];
type FundRow = FundTrackingDto["members"][number];

const FIGURES = ["assigned", "contributed", "consumed", "gap"] as const;

/** An amount other than zero; a missing figure is no amount. */
const isMoney = (value: MoneyDto | null): boolean => value !== null && BigInt(value.amount) !== 0n;

const hasMoney = (cell: Cell): boolean => FIGURES.some((figure) => isMoney(cell[figure]));

/** #217: the fund's rows without a member who was expected nothing and paid nothing in the period. */
export const activeFundRows = (rows: readonly FundRow[]): FundRow[] =>
  rows.filter((row) => isMoney(row.expected) || isMoney(row.actual) || isMoney(row.difference));

/**
 * #213, #217: a member whose every figure in the period is zero or missing, on every line, is left out of the
 * matrix, so the rows answer who takes part. A member with any amount on any line keeps a row on every line.
 * Nothing is summed; the figures shown are still the API's (ruling P201).
 */
export const withoutIdleMembers = (matrix: MemberMatrixDto): MemberMatrixDto => {
  const active = new Set(
    matrix.lines.flatMap((line) => line.members.filter(hasMoney).map((cell) => cell.memberId)),
  );
  return {
    ...matrix,
    lines: matrix.lines.map((line) => ({
      ...line,
      members: line.members.filter((cell) => active.has(cell.memberId)),
    })),
  };
};
