"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { Amount, AMOUNT_ROW, AMOUNT_ROW_AMOUNT, AMOUNT_ROW_LABEL } from "@/shared/ui/atoms/amount";
import { formatDayMonthYear } from "@/shared/ui/format/day-month";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { relativeDay } from "@/shared/ui/time/when";
import { friendTotals, initialsOf, type FriendDto } from "./friends";
import { absolute, netState, type NetState } from "./net-state";

/** The tone of each direction: what is owed to the viewer in the accent, what she owes in the warm --owe ink. */
export const FRIEND_TONE: Record<NetState, string> = {
  owed: "text-accent",
  owes: "text-owe-ink",
  settled: "text-muted",
};

/** A person's initials in their round tint: warm when the viewer owes them, as the board draws Jhon López. */
export function FriendAvatar({
  name,
  state,
  size = 44,
}: {
  readonly name: string;
  readonly state: NetState;
  readonly size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-sm font-semibold ${state === "owes" ? "bg-owe-soft text-owe-ink" : "bg-accent-soft text-accent"}`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** The day a movement is labelled with, as Movimientos labels it: "Hoy", "Ayer", "3 oct", "12 mar 2025". */
export function useDayLabel(formats: Formats, today: string): (date: string) => string {
  const common = useTranslations("common");
  const ledger = useTranslations("ledger");
  return (date) => {
    const day = relativeDay(date, today);
    return day === "today" || day === "yesterday"
      ? ledger(`day.${day}`)
      : formatDayMonthYear(date, common(`monthShort.${Number(date.slice(5, 7)) as 1}`), formats, today);
  };
}

/** Sums in several currencies, which never add up, side by side. */
const joined = (amounts: readonly MoneyDto[], formats: Formats, zero: string): string =>
  amounts.length === 0 ? zero : amounts.map((money) => formatMoney(money, formats)).join(" + ");

/**
 * Ruling P338 (board "Amigos · cada persona con su saldo"): the personal space's Amigos, where Saldos is in a group.
 * Each person the viewer shares a direct space with, by the name she gives them, with the newest movement between the
 * two and who owes whom: "Te debe" in the accent, "Le debes" in the warm tone, or "Al día", always in words beside the
 * amount, never by colour alone. Over them, the totals owed each way. Each row opens the person's screen.
 */
export function FriendsScreen({
  spaceId,
  friends,
  formats,
  today,
}: {
  /** The personal space, whose address the person screens keep. */
  readonly spaceId: string;
  readonly friends: readonly FriendDto[];
  readonly formats: Formats;
  /** The viewer's own date, so a movement says "Ayer" or its day. */
  readonly today: string;
}) {
  const t = useTranslations("friends");
  const dayOf = useDayLabel(formats, today);
  const totals = friendTotals(friends);
  const zero = formatMoney({ amount: "0", currency: friends[0]?.net.currency ?? "COP" }, formats);
  return (
    <div className="flex flex-col gap-3 pb-3">
      <header className="flex flex-col gap-1 pt-1">
        <h1 id="friends-title" className="text-2xl font-semibold text-ink">
          {t("title")}
        </h1>
        {friends.length > 0 ? (
          <p className="text-[15px] text-ink tabular-nums [overflow-wrap:anywhere]">
            {t("totals", {
              owed: joined(totals.owed, formats, zero),
              owe: joined(totals.owe, formats, zero),
            })}
          </p>
        ) : null}
      </header>
      {friends.length === 0 ? (
        <p className="border-y border-line py-3 text-base text-muted">{t("empty")}</p>
      ) : (
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
      )}
    </div>
  );
}
