"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { Amount, AMOUNT_ROW, AMOUNT_ROW_AMOUNT, AMOUNT_ROW_LABEL } from "@/shared/ui/atoms/amount";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { useDayLabel } from "./day-label";
import { FRIEND_TONE, FriendAvatar } from "./friend-avatar";
import { FriendRequests } from "./friend-requests";
import { friendTotals, type FriendDto, type FriendRequestsDto } from "./friends";
import { absolute, netState } from "./net-state";

// Agregar amigo loads only when it opens (ADR 0004).
const AddFriendSheet = dynamic(() => import("./add-friend-sheet").then((module) => module.AddFriendSheet), {
  ssr: false,
});

const NO_REQUESTS: FriendRequestsDto = { incoming: [], outgoing: [] };

/** Sums in several currencies, which never add up, side by side. */
const joined = (amounts: readonly MoneyDto[], formats: Formats, zero: string): string =>
  amounts.length === 0 ? zero : amounts.map((money) => formatMoney(money, formats)).join(" + ");

/**
 * Ruling P338 (board "Amigos · cada persona con su saldo"): the personal space's Amigos, where Saldos is in a group.
 * Each person the viewer shares a direct space with, by the name she gives them, with the newest movement between the
 * two and who owes whom: "Te debe" in the accent, "Le debes" in the warm tone, or "Al día", always in words beside the
 * amount, never by colour alone. Over them, the totals owed each way. Each row opens the person's screen. Ruling P339
 * (board "Amigos · solicitudes y eliminar"): "+" opens Agregar amigo, and the pending requests come before the friends.
 */
export function FriendsScreen({
  spaceId,
  friends,
  formats,
  today,
  requests = NO_REQUESTS,
  myHandle,
  addHandle,
  api,
}: {
  /** The personal space, whose address the person screens keep. */
  readonly spaceId: string;
  readonly friends: readonly FriendDto[];
  readonly formats: Formats;
  /** The viewer's own date, so a movement says "Ayer" or its day. */
  readonly today: string;
  /** Ruling P339: the friend requests the viewer received and sent. */
  readonly requests?: FriendRequestsDto;
  /** The viewer's own @, which Agregar amigo shares; absent while they have none. */
  readonly myHandle?: string;
  /** Ruling P339 (S6): the @ a friend link carried; Agregar amigo opens with it filled in. */
  readonly addHandle?: string;
  readonly api?: Api;
}) {
  const t = useTranslations("friends");
  const dayOf = useDayLabel(formats, today);
  const [adding, setAdding] = useState(addHandle !== undefined);
  const totals = friendTotals(friends);
  const zero = formatMoney({ amount: "0", currency: friends[0]?.net.currency ?? "COP" }, formats);
  return (
    <div className="flex flex-col gap-3 pb-3">
      <header className="flex flex-col gap-1 pt-1">
        <div className="flex items-center justify-between gap-2">
          <h1 id="friends-title" className="text-2xl font-semibold text-ink">
            {t("title")}
          </h1>
          <Button
            variant="ghost"
            size="iconCompact"
            className="-mr-2"
            aria-label={t("add.open")}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" />
          </Button>
        </div>
        {friends.length > 0 ? (
          <p className="text-[15px] text-ink tabular-nums [overflow-wrap:anywhere]">
            {t("totals", {
              owed: joined(totals.owed, formats, zero),
              owe: joined(totals.owe, formats, zero),
            })}
          </p>
        ) : null}
      </header>
      <FriendRequests requests={requests} api={api} />
      {friends.length === 0 ? (
        <p className="border-y border-line py-3 text-base text-muted">{t("empty")}</p>
      ) : (
        <section className="flex flex-col">
          {requests.incoming.length + requests.outgoing.length > 0 ? (
            <h2 className="text-[13px] font-semibold text-muted">{t("mine", { count: friends.length })}</h2>
          ) : null}
          <ul aria-labelledby="friends-title" className="divide-y divide-line">
            {friends.map((friend) => {
              const state = netState(friend.net);
              const last = friend.lastMovement;
              return (
                <li key={friend.spaceId}>
                  <Link
                    href={`/spaces/${spaceId}/friends/${friend.spaceId}`}
                    className="flex min-h-row-lg items-center gap-3 py-2"
                  >
                    <FriendAvatar name={friend.name} state={state} />
                    {/* P335: the amount sits beside the name while they fit, and moves whole under it when not. */}
                    <span className={`${AMOUNT_ROW} min-w-0 flex-1 items-center`}>
                      <span className={`${AMOUNT_ROW_LABEL} flex flex-col`}>
                        <span className="font-medium [overflow-wrap:anywhere] text-ink">{friend.name}</span>
                        <span className="text-[13px] [overflow-wrap:anywhere] text-muted">
                          {last
                            ? `${last.description || t(`type.${last.type}`)} · ${dayOf(last.date)}`
                            : t("noMovements")}
                        </span>
                      </span>
                      <span className={`${AMOUNT_ROW_AMOUNT} flex flex-col items-end`}>
                        <span className={`text-[13px] font-semibold ${FRIEND_TONE[state]}`}>
                          {t(`state.${state}`)}
                        </span>
                        {state === "settled" ? null : (
                          <Amount className={`font-semibold ${FRIEND_TONE[state]}`}>
                            {formatMoney(absolute(friend.net), formats)}
                          </Amount>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {adding ? (
        <AddFriendSheet
          open
          onOpenChange={setAdding}
          personalSpaceId={spaceId}
          myHandle={myHandle}
          initialHandle={addHandle}
          api={api}
        />
      ) : null}
    </div>
  );
}
