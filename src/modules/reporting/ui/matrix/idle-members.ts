import type { MemberMatrixDto } from "@/shared/ui/api/dto";

type Cell = MemberMatrixDto["lines"][number]["members"][number];

const FIGURES = ["assigned", "contributed", "consumed", "gap"] as const;

/** True when a cell carries an amount other than zero; a null figure is no amount. */
const hasMoney = (cell: Cell): boolean =>
  FIGURES.some((figure) => {
    const value = cell[figure];
    return value !== null && BigInt(value.amount) !== 0n;
  });

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
