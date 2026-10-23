import type { RolloverMode } from "./budget-line";

/**
 * HU-E6-09 RolloverCalculator, spec 5.4: what a line carries over from the line it was copied from, by its own
 * rollover mode (ruling P15). RESET carries nothing; ROLLOVER the previous available floored at 0 (Firefly
 * semantics); ADJUSTED only an overspend, a negative previous available. Without a previous available it carries 0.
 */
export const carryOver = (mode: RolloverMode, previousAvailable: bigint | null): bigint => {
  if (previousAvailable === null || mode === "RESET") return 0n;
  if (mode === "ROLLOVER") return previousAvailable > 0n ? previousAvailable : 0n;
  return previousAvailable < 0n ? previousAvailable : 0n;
};

/**
 * HU-E6-09: whether a plan's lines read a carry-over from the plan it was copied from, which is true when one of
 * them has an origin line and a mode other than RESET. A line without an origin carries nothing (ruling P243).
 */
export const carriesFromSource = (
  lines: readonly { readonly originLineId: string | null; readonly rolloverMode: RolloverMode }[],
): boolean => lines.some((line) => line.originLineId !== null && line.rolloverMode !== "RESET");
