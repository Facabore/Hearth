import type { paths } from "@/shared/ui/api/schema";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { netsOf } from "./nets";

/** Ruling P338: one person of Amigos, the other member of one of the viewer's direct spaces, as the API answers it. */
export type FriendDto =
  paths["/api/v1/me/friends"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

/** Ruling P339 (S4): the friend requests the viewer received and sent, as the API answers them. */
export type FriendRequestsDto =
  paths["/api/v1/me/friend-requests"]["get"]["responses"][200]["content"]["application/json"];

/** One friend request: the other person's name and @ (null when they have none any more). */
export type FriendRequestDto = FriendRequestsDto["incoming"][number];

/** Ruling P338: what the person owes the viewer and what the viewer owes, one sum per currency (amounts never mix). */
export interface FriendTotals {
  readonly owed: readonly MoneyDto[];
  readonly owe: readonly MoneyDto[];
}

/**
 * Ruling P338 (board "Amigos · cada persona con su saldo"): the totals owed each way. A positive net is owed to the
 * viewer, a negative one she owes; both come out positive. Ruling P342 (S4): every person's net in each currency
 * counts, one sum per currency, never converted.
 */
export const friendTotals = (friends: readonly FriendDto[]): FriendTotals => {
  const owed = new Map<string, bigint>();
  const owe = new Map<string, bigint>();
  for (const net of friends.flatMap(netsOf)) {
    const value = BigInt(net.amount);
    const side = value > 0n ? owed : owe;
    side.set(net.currency, (side.get(net.currency) ?? 0n) + (value > 0n ? value : -value));
  }
  const list = (sums: Map<string, bigint>) =>
    [...sums].map(([currency, amount]) => ({ amount: amount.toString(), currency }));
  return { owed: list(owed), owe: list(owe) };
};

/** A person's initials, at most two: "Jhon López" is "JL", "Mamá" is "M". */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

/**
 * Ruling P339: an @ as the API reads it: trimmed, without one leading "@" and in lower case ("@Fabian" is "fabian").
 */
export const handleOf = (typed: string): string => typed.trim().replace(/^@/, "").toLowerCase();

/** Ruling P339 (S2): whether an @ can be someone's: 3–20 lower-case letters a–z, digits and underscores. */
export const isHandle = (handle: string): boolean => /^[a-z0-9_]{3,20}$/.test(handle);

/** Ruling P339 (S6): the link that opens Agregar amigo with this @ filled in; the profile sheet shares it too (P343). */
export { friendLinkOf } from "@/shared/ui/share-link";
