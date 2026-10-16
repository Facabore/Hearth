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
