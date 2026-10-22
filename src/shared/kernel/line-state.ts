/** #142, ruling P244 (M6c): how much of a budget line is used, as the dashboard and the record form's preview say it. */
export type LineState = "OK" | "NEAR" | "HIGH" | "OVER";

/**
 * `budget` is planned + carry-over and `available` what is left of it, in minor units. OVER once less than 0 is
 * left; HIGH above 90 % used (100 % included); NEAR from 80 % through 90 %; else OK. Integer arithmetic only.
 */
export const lineStateOf = (budget: bigint, available: bigint): LineState => {
  if (available < 0n) return "OVER";
  if (budget <= 0n) return "OK";
  const used = budget - available;
  if (used * 100n > budget * 90n) return "HIGH";
  return used * 100n >= budget * 80n ? "NEAR" : "OK";
};
