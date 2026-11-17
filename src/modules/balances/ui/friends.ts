import type { paths } from "@/shared/ui/api/schema";
import type { MoneyDto } from "@/shared/ui/api/dto";

/** Ruling P338: one person of Amigos, the other member of one of the viewer's direct spaces, as the API answers it. */
export type FriendDto =
  paths["/api/v1/me/friends"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

/** Ruling P338: what the person owes the viewer and what the viewer owes, one sum per currency (amounts never mix). */
export interface FriendTotals {
  readonly owed: readonly MoneyDto[];
  readonly owe: readonly MoneyDto[];
}

const sums = (amounts: readonly MoneyDto[]): MoneyDto[] => {
  const byCurrency = new Map<string, bigint>();
  for (const money of amounts)
    byCurrency.set(money.currency, (byCurrency.get(money.currency) ?? 0n) + BigInt(money.amount));
  return [...byCurrency].map(([currency, amount]) => ({ amount: amount.toString(), currency }));
};

/**
 * Ruling P338 (board "Amigos · cada persona con su saldo"): the totals owed each way. A positive net is owed to the
 * viewer, a negative one she owes; both come out positive.
 */
export const friendTotals = (friends: readonly FriendDto[]): FriendTotals => ({
  owed: sums(friends.filter((f) => BigInt(f.net.amount) > 0n).map((f) => f.net)),
  owe: sums(
    friends
      .filter((f) => BigInt(f.net.amount) < 0n)
      .map((f) => ({ ...f.net, amount: f.net.amount.replace(/^-/, "") })),
  ),
});

/** A person's initials, at most two: "Jhon López" is "JL", "Mamá" is "M". */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
