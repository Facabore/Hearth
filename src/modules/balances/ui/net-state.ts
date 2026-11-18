import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

export { netsOf } from "./nets";

export type NetState = "owes" | "owed" | "settled";
export type SentenceT = (
  key: "member.owes" | "member.owed" | "member.settled",
  values: { amount: string },
) => string;

/** HU-E5-01: a negative net owes the space, a positive one is owed, zero is settled up. */
export const netState = (net: MoneyDto): NetState => {
  const value = BigInt(net.amount);
  return value < 0n ? "owes" : value > 0n ? "owed" : "settled";
};

export const absolute = (money: MoneyDto): MoneyDto => ({
  ...money,
  amount: money.amount.replace(/^-/, ""),
});

/** Ruling P173: a member's net as a sentence of the `balances` catalog, never a sign glued to an amount. */
export const memberSentence = (net: MoneyDto, formats: Formats, t: SentenceT): string =>
  t(`member.${netState(net)}`, { amount: formatMoney(absolute(net), formats) });

/** Ruling P342: nets grouped by direction, in the order each direction first appears ("Le debes" COP, "Te debe" USD). */
export const byDirection = (
  nets: readonly MoneyDto[],
): { readonly state: Exclude<NetState, "settled">; readonly amounts: readonly MoneyDto[] }[] => {
  const groups = new Map<Exclude<NetState, "settled">, MoneyDto[]>();
  for (const net of nets) {
    const state = netState(net);
    if (state === "settled") continue;
    groups.set(state, [...(groups.get(state) ?? []), net]);
  }
  return [...groups].map(([state, amounts]) => ({ state, amounts }));
};
