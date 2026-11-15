import { useEffect, useState } from "react";
import type { Api } from "@/shared/ui/api/client";

/**
 * What the recorder owes the person in that space, in minor units, from its pair-by-pair suggestions (P323): positive
 * when the recorder owes, negative when the person owes the recorder, zero when neither owes the other.
 */
export const debtWith = (
  suggestions: readonly {
    readonly payerMemberId: string;
    readonly receivingMemberId: string;
    readonly amount: { readonly amount: string };
  }[],
  me: string,
  them: string,
): bigint =>
  suggestions.reduce((owed, s) => {
    if (s.payerMemberId === me && s.receivingMemberId === them) return owed + BigInt(s.amount.amount);
    if (s.payerMemberId === them && s.receivingMemberId === me) return owed - BigInt(s.amount.amount);
    return owed;
  }, 0n);

/**
 * P334: what the recorder owes someone in one space (positive) or they owe the recorder (negative), from that space's
 * pair suggestions only; null while unread or unreadable, zero for a direct space not created yet (`spaceId` null).
 * Kept with the space and the pair it was read for, so switching person in the same group never shows the previous
 * one's.
 */
export const usePairDebt = (
  api: Api,
  place: {
    readonly spaceId: string | null;
    readonly myMemberId: string | null;
    readonly theirMemberId: string | null;
  } | null,
): bigint | null => {
  const spaceId = place?.spaceId ?? null;
  const me = place?.myMemberId ?? null;
  const them = place?.theirMemberId ?? null;
  const [owed, setOwed] = useState<{ readonly key: string; readonly minor: bigint } | null>(null);
  useEffect(() => {
    if (spaceId === null || me === null || them === null) return;
    let live = true;
    void api
      .GET("/api/v1/spaces/{spaceId}/balances/suggestions", { params: { path: { spaceId } } })
      .then(({ data }) => {
        if (live && data)
          setOwed({ key: `${spaceId}|${me}|${them}`, minor: debtWith(data.suggestions, me, them) });
      })
      // Unread, the card waits and the row says only "Espacio": the transfer can still be saved.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, spaceId, me, them]);
  if (place === null) return null;
  if (spaceId === null) return 0n;
  return owed?.key === `${spaceId}|${me}|${them}` ? owed.minor : null;
};
