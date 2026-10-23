import type { MoneyDto } from "@/shared/ui/api/dto";

/**
 * Ruling P202: how much of a bar a line fills, 0–100; presentation, never shown as a figure. It is measured against
 * planned + carry-over (HU-E6-09, ruling P231 of M6c), the budget the line really has.
 */
export const barWidth = (spent: MoneyDto, planned: MoneyDto, carryOver?: MoneyDto): number => {
  const used = BigInt(spent.amount);
  const plan = BigInt(planned.amount) + BigInt(carryOver?.amount ?? "0");
  if (plan <= 0n) return used > 0n ? 100 : 0;
  const width = (used * 100n) / plan;
  return Number(width > 100n ? 100n : width < 0n ? 0n : width);
};
