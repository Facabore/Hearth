"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { preferredAccountId, readLastAccount } from "@/modules/ledger/ui";
import { controlsFor, GuestInvite } from "@/modules/spaces/ui";
import { Button, ScreenHeader } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  BalanceHistoryDto,
  BalancesDto,
  MemberDto,
  SpaceDto,
  SuggestionDto,
} from "@/shared/ui/api/dto";
import { Amount, AMOUNT_ROW, AMOUNT_ROW_AMOUNT, AMOUNT_ROW_LABEL } from "@/shared/ui/atoms/amount";
import { HeroAmount } from "@/shared/ui/atoms/hero-amount";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { useDayLabel } from "./day-label";
import { FRIEND_TONE, FriendAvatar } from "./friend-avatar";
import type { FriendDto } from "./friends";
import { absolute, netState } from "./net-state";
import { NicknameSheet } from "./nickname-sheet";
import { prefillOf, type SettlementDraft } from "./settlement-prefill";

// The settle-up sheet loads only when it opens (ADR 0004), as on Saldos.
const SettleUpSheet = dynamic(() => import("./settle-up-sheet").then((module) => module.SettleUpSheet), {
  ssr: false,
});

// Removing a friend's sheet loads only when it opens (ADR 0004).
const RemoveFriendSheet = dynamic(
  () => import("./remove-friend-sheet").then((module) => module.RemoveFriendSheet),
  { ssr: false },
);

/** How many movements show at first, and how many more each "Cargar más" shows. */
const PAGE = 20;

type Entry = BalanceHistoryDto["entries"][number];

interface Settling {
  readonly draft: SettlementDraft;
  readonly suggested: boolean;
  readonly lastAccountId: string | null;
}

/**
 * Ruling P338 (board "Amigo · Mom"): one person of Amigos, under the personal space's address, with a way back to
 * Amigos. Their name (the viewer's apodo, editable from "Apodo"), and under it "No usa Hearth" for a guest or
 * their own name when the apodo hides it; who owes whom in words over the amount; "Saldar", which opens Saldos'
 * settle-up sheet for their direct space, and "Registrar con …", the record form in that space, which comes back here.
 * "Entre tú y …" lists every movement that moved the balance between the two, newest first, each signed by what it did
 * to the viewer's balance, with "Cargar más"; then that nobody else sees it, and for a guest the invitation to Hearth.
 * Ruling P339 (S7): last, "Eliminar de Amigos", which removes the person once the two are even.
 */
export function FriendScreen({
  personalSpaceId,
  friend,
  space,
  members,
  meUserId,
  balances,
  suggestions,
  history,
  formats,
  today,
  timeZone,
  myAccounts = [],
  api,
}: {
  readonly personalSpaceId: string;
  readonly friend: FriendDto;
  /** The direct space the two share. */
  readonly space: SpaceDto;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  readonly balances: BalancesDto["members"];
  readonly suggestions: readonly SuggestionDto[];
  /** Every movement that moved the viewer's balance in the space, oldest first, as the API answers it. */
  readonly history: BalanceHistoryDto;
  readonly formats: Formats;
  readonly today: string;
  readonly timeZone: string;
  /** The active accounts the viewer owns: where a payment of theirs may leave from or arrive in. */
  readonly myAccounts?: readonly AccountDto[];
  readonly api?: Api;
}) {
  const t = useTranslations("friends");
  const dayOf = useDayLabel(formats, today);
  const name = friend.name;
  const me = friend.me.memberId;
  const net = balances.find((balance) => balance.memberId === me)?.net ?? friend.net;
  const state = netState(net);
  const here = `/spaces/${personalSpaceId}/friends/${space.id}`;
  const canSettle = controlsFor(space.role, space.kind).recordMoney && members.some((m) => m.id === me);
  const guest = friend.other.kind === "GUEST";
  // Ruling P339: a registered person's @ under their name, after their own name when an apodo stands in for it.
  const handle = friend.other.handle ? `@${friend.other.handle}` : undefined;
  const subtitle = guest
    ? t("person.guest")
    : [friend.other.nickname ? friend.other.displayName : undefined, handle].filter(Boolean).join(" · ") ||
      undefined;
  const [naming, setNaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [settling, setSettling] = useState<Settling | null>(null);
  const [shown, setShown] = useState(PAGE);
  const entries = [...history.entries].reverse();

  const settle = () => {
    const suggestion = suggestions[0] ?? null;
    setSettling({
      draft: prefillOf({
        suggestion,
        // A balance always has its suggestion; al día, the sheet opens with the other one paying the viewer.
        payerMemberId: friend.other.memberId,
        meMemberId: me,
        currency: space.currency,
        numberFormat: formats.numberFormat,
      }),
      suggested: suggestion !== null,
      lastAccountId: readLastAccount(),
    });
  };

  /** What the movement was between the two, from the viewer's side: who paid, and whose part. */
  const whoOf = (entry: Entry): string | null => {
    if (entry.type === "SETTLEMENT") {
      if (entry.settlementReason === "FORGIVENESS") {
        if (entry.payerMemberId === me) return t("person.forgivenToYou", { name });
        if (entry.receivingMemberId === me) return t("person.forgivenByYou", { name });
        return null;
      }
      // Ruling P339: money handed between the two pays a debt or lends, by the balance just before it (the viewer's
      // net, positive when the other owed her), and both when it goes past the debt.
      const after = BigInt(entry.balance.amount);
      const before = after - BigInt(entry.change.amount);
      const money = (minor: bigint) =>
        formatMoney({ amount: minor.toString(), currency: entry.change.currency }, formats);
      if (entry.payerMemberId === me) {
        if (before >= 0n) return t("person.youLent", { name });
        if (after <= 0n) return t("person.youPaid", { name });
        return t("person.youPaidAndLent", { name, paid: money(-before), lent: money(after) });
      }
      if (entry.receivingMemberId === me) {
        if (before <= 0n) return t("person.lentYou", { name });
        if (after >= 0n) return t("person.paidYou", { name });
        return t("person.paidAndLentYou", { name, paid: money(before), lent: money(-after) });
      }
      return null;
    }
    const change = BigInt(entry.change.amount);
    if (change > 0n) return t("person.youPaidShare");
    if (change < 0n) return t("person.theyPaidShare", { name });
    return null;
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenHeader backHref={`/spaces/${personalSpaceId}/balances`} title={t("title")} />
      <section aria-labelledby="friend-name" className="flex items-center gap-3">
        <FriendAvatar name={name} state={state} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id="friend-name" className="text-2xl font-semibold [overflow-wrap:anywhere] text-ink">
            {name}
          </h2>
          {subtitle ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{subtitle}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="compact"
          className="-mr-2 shrink-0"
          aria-label={t("person.nicknameOf", { name })}
          onClick={() => setNaming(true)}
        >
          {t("person.nickname")}
        </Button>
      </section>
      <section aria-label={t(`person.${state}`, { name })} className="flex flex-col">
        <span className="text-[15px] text-muted [overflow-wrap:anywhere]">
          {t(`person.${state}`, { name })}
        </span>
        {/* P335: one line at any width, font or number of digits; the figure scales with the hero's width. */}
        <HeroAmount
          amount={formatMoney(absolute(net), formats)}
          size="2.25rem"
          className="leading-tight font-semibold text-ink"
        />
      </section>
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
        {canSettle ? (
          <Button size="lgFlow" className="min-h-14" onClick={settle}>
            {t("person.settle")}
          </Button>
        ) : null}
        <Button asChild variant="secondary" size="lgFlow" className="min-h-14 text-center">
          <Link href={withReturnTo(`/spaces/${space.id}/new`, here)}>{t("person.record", { name })}</Link>
        </Button>
      </div>
      <section aria-labelledby="friend-between" className="flex flex-col">
        <h2 id="friend-between" className="text-[13px] font-semibold text-muted">
          {t("person.between", { name })}
        </h2>
        {entries.length === 0 ? (
          <p className="py-3 text-base text-muted">{t("person.empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.slice(0, shown).map((entry) => {
              const who = whoOf(entry);
              const change = BigInt(entry.change.amount);
              return (
                <li key={entry.transactionId} className="flex min-h-row-lg items-center py-2">
                  <span className={`${AMOUNT_ROW} min-w-0 flex-1 items-center`}>
                    <span className={`${AMOUNT_ROW_LABEL} flex flex-col`}>
                      <span className="font-medium [overflow-wrap:anywhere] text-ink">
                        {entry.description || t(`type.${entry.type}`)}
                      </span>
                      <span className="text-[13px] [overflow-wrap:anywhere] text-muted">
                        {[dayOf(entry.date), who].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Amount
                      className={`${AMOUNT_ROW_AMOUNT} font-semibold ${change > 0n ? FRIEND_TONE.owed : "text-ink"}`}
                    >
                      {formatSignedMoney(entry.change, formats)}
                    </Amount>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {entries.length > shown ? (
          <Button
            variant="ghost"
            size="compact"
            className="self-start"
            onClick={() => setShown(shown + PAGE)}
          >
            {t("person.more")}
          </Button>
        ) : null}
      </section>
      <p className="text-sm text-muted">{t("person.private")}</p>
      {guest && controlsFor(space.role, space.kind).claimLinks ? (
        <GuestInvite
          spaceId={space.id}
          guestId={friend.other.memberId}
          name={friend.name}
          formats={formats}
          viewerZone={timeZone}
          api={api}
        />
      ) : null}
      <Button variant="dangerGhost" size="compact" className="self-start" onClick={() => setRemoving(true)}>
        {t("remove.action")}
      </Button>
      {naming ? <NicknameSheet open onOpenChange={setNaming} friend={friend} api={api} /> : null}
      {removing ? (
        <RemoveFriendSheet
          open
          onOpenChange={setRemoving}
          friend={friend}
          even={state === "settled"}
          personalSpaceId={personalSpaceId}
          onSettle={canSettle ? settle : undefined}
          api={api}
        />
      ) : null}
      {canSettle && settling ? (
        <SettleUpSheet
          open
          onOpenChange={(open) => {
            if (!open) setSettling(null);
          }}
          space={space}
          members={members}
          meUserId={meUserId}
          myAccounts={myAccounts}
          suggestions={suggestions}
          initial={settling.draft}
          suggested={settling.suggested}
          lastAccountId={settling.lastAccountId}
          preferredAccountId={preferredAccountId(myAccounts, settling.lastAccountId)}
          formats={formats}
          timeZone={timeZone}
          api={api}
        />
      ) : null}
    </div>
  );
}
