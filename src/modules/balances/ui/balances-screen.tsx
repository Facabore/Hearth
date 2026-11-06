"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlsFor, memberLabel } from "@/modules/spaces/ui";
import { Avatar, Button, Icon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, BalancesDto, MemberDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";
import { SettleUpSheet } from "./settle-up-sheet";
import { prefillOf, type SettlementDraft } from "./settlement-request";

/** An open settle-up sheet: its draft, and whether a suggestion filled it in. */
interface Settling {
  readonly draft: SettlementDraft;
  readonly suggested: boolean;
}

/**
 * HU-E9-07, the Balances artboard as `/spaces/{spaceId}/balances` (the Saldos tab, ruling P173): the viewer's own
 * net, the API's settle-up suggestions and every current member's net. Only the header speaks to the viewer; the
 * suggestions and the members always use names, so the story's sentences read the same from every seat. Each member
 * row links to a history page that is rarely opened, so the links do not prefetch it (one request per member).
 *
 * Settling up (rulings P174 and P175): "Saldar" on a suggestion and "Saldar otro monto" only fill in the settle-up
 * sheet; a payment is recorded when the person saves it. `settle` (the guest sheet's link) opens the sheet for that
 * member. A viewer who cannot record money reads the balances without either control.
 *
 * Ruling P272 (board 01): each suggestion is its own card with a filled "Saldar", "Saldar otro monto" is a text link,
 * and each member row ends in a chevron. The board's strip with the viewer's balance in another space is not drawn:
 * the API answers balances one space at a time.
 */
export function BalancesScreen({
  space,
  members,
  meUserId,
  balances,
  suggestions,
  formats,
  myAccounts = [],
  settle,
  timeZone,
  api,
}: {
  readonly space: SpaceDto;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  readonly balances: BalancesDto["members"];
  readonly suggestions: readonly SuggestionDto[];
  readonly formats: Formats;
  /** The active accounts the viewer owns: where a payment of theirs may leave from or arrive in. */
  readonly myAccounts?: readonly AccountDto[];
  /** A member id from `?settle=`: the sheet opens with that member paying. */
  readonly settle?: string | undefined;
  readonly timeZone?: string;
  readonly api?: Api;
}) {
  const t = useTranslations("balances");
  const router = useRouter();
  const tMembers = useTranslations("members");
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  const netOf = (memberId: string) =>
    balances.find((balance) => balance.memberId === memberId)?.net ?? {
      amount: "0",
      currency: space.currency,
    };
  // #217 (P263): a member no movement ever touched and whose balance is zero is left out of the list. An older API that
  // does not send `hasMovements` leaves everyone in. The viewer always keeps their own row, with its way to their
  // history, even before they take part.
  const listed = members.filter((member) => {
    if (member.userId === meUserId) return true;
    const balance = balances.find((b) => b.memberId === member.id);
    return balance === undefined || balance.hasMovements !== false || BigInt(balance.net.amount) !== 0n;
  });
  const viewer = members.find((member) => member.userId === meUserId);
  const mine = viewer ? netOf(viewer.id) : netOf("");
  const state = netState(mine);

  // P302: the personal space has Saldos too, where the person is always al día; it has no one to settle with and no
  // history to open (P159), so the screen says so instead of listing suggestions and members.
  const personal = space.kind === "PERSONAL";
  const canSettle = !personal && viewer !== undefined && controlsFor(space.role, space.kind).recordMoney;
  // #217: a VIEWER records nothing, so one whose balance is zero is no one to settle with and is not offered.
  const settleable = members.filter(
    (member) => member.role !== "VIEWER" || BigInt(netOf(member.id).amount) !== 0n,
  );
  // Board 02: an opening from a suggestion says so under the sheet's title.
  const prefill = (suggestion: SuggestionDto | null, payerMemberId?: string): Settling => ({
    draft: prefillOf({
      suggestion,
      payerMemberId,
      meMemberId: viewer?.id ?? "",
      currency: space.currency,
      numberFormat: formats.numberFormat,
    }),
    suggested: suggestion !== null,
  });
  // The sheet is mounted only while it is open, so each opening starts from its own prefill and forgets the last attempt.
  const [settling, setSettling] = useState<Settling | null>(() =>
    canSettle && settle && members.some((member) => member.id === settle)
      ? prefill(suggestions.find((s) => s.payerMemberId === settle) ?? null, settle)
      : null,
  );

  return (
    <div className="flex flex-col gap-3 pb-3">
      <h1 className="sr-only">{t("title")}</h1>
      {/* Board 01 (P272): the viewer's net in ink, its words saying the direction. The members are one tap away in the
          profile sheet and on Inicio, so Saldos has no Miembros button of its own. */}
      <section aria-label={t("yours", { space: space.name })} className="flex flex-col gap-1 pt-1">
        <span className="min-w-0 text-[15px] text-muted [overflow-wrap:anywhere]">
          {t("yours", { space: space.name })}
        </span>
        <span className="text-[30px] leading-tight font-semibold tabular-nums text-ink">
          {t(`you.${state}`, { amount: formatMoney(absolute(mine), formats) })}
        </span>
      </section>
      {personal ? (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">
          {t("personalNote", { space: space.name })}
        </p>
      ) : (
        <>
          <section aria-labelledby="balances-suggestions" className="flex flex-col gap-2">
            <h2 id="balances-suggestions" className="text-[17px] font-semibold text-ink">
              {t("suggestions")}
            </h2>
            {suggestions.length === 0 ? (
              <p className="rounded-2xl bg-track p-3 text-sm text-ink">
                {t("allSettled", { space: space.name })}
              </p>
            ) : (
              <>
                <ol className="flex flex-col gap-2">
                  {suggestions.map((suggestion) => {
                    const payer = names.get(suggestion.payerMemberId) ?? "";
                    const receiver = names.get(suggestion.receivingMemberId) ?? "";
                    const sentence = t("owes", {
                      payer,
                      receiver,
                      amount: formatMoney(suggestion.amount, formats),
                    });
                    return (
                      <li
                        key={`${suggestion.payerMemberId}-${suggestion.receivingMemberId}`}
                        className="flex min-h-row-lg items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5"
                      >
                        <Avatar name={payer} />
                        <span className="min-w-0 flex-1 text-[15px] text-ink tabular-nums [overflow-wrap:anywhere]">
                          {sentence}
                        </span>
                        {canSettle ? (
                          <Button
                            size="chip"
                            className="shrink-0"
                            aria-label={t("settle.suggestion", {
                              payer,
                              receiver,
                              amount: formatMoney(suggestion.amount, formats),
                            })}
                            onClick={() => setSettling(prefill(suggestion))}
                          >
                            {t("settle.action")}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                <p className="text-[13px] text-muted">{t("suggestionsNote")}</p>
              </>
            )}
          </section>
          <section aria-labelledby="balances-members" className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="balances-members" className="min-w-0 text-[17px] font-semibold text-ink">
                {t("members")}
              </h2>
              {canSettle ? (
                <Button
                  variant="ghost"
                  size="compact"
                  className="shrink-0"
                  onClick={() => setSettling(prefill(null))}
                >
                  {t("record")}
                </Button>
              ) : null}
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface empty:hidden">
              {listed.map((member) => {
                const net = netOf(member.id);
                const memberState = netState(net);
                const sentence = memberSentence(net, formats, t);
                const name = memberLabel(member, meUserId, tMembers);
                return (
                  <li key={member.id}>
                    <Link
                      href={`/spaces/${space.id}/members/${member.id}/history`}
                      aria-label={t("member.link", { name, sentence })}
                      prefetch={false}
                      className="flex min-h-row-lg items-center gap-2 py-1.5 pr-2.5 pl-3.5"
                    >
                      <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] text-ink">
                        {name}
                      </span>
                      <span
                        className={`text-[15px] font-semibold tabular-nums ${memberState === "owes" ? "text-owe" : memberState === "owed" ? "text-accent" : "text-muted"}`}
                      >
                        {sentence}
                      </span>
                      {/* Board 01: the chevron says the row opens the member's history. */}
                      <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
      {canSettle && settling ? (
        <SettleUpSheet
          open
          onOpenChange={(open) => {
            if (open) return;
            setSettling(null);
            // N8: `?settle=` only opened the sheet. Once it closes (saved or not) the address drops it by replacing the
            // entry, so a reload does not reopen the sheet and Back does not return to it.
            if (settle) router.replace(`/spaces/${space.id}/balances`);
          }}
          space={space}
          members={settleable}
          meUserId={meUserId}
          myAccounts={myAccounts}
          suggestions={suggestions}
          initial={settling.draft}
          suggested={settling.suggested}
          formats={formats}
          timeZone={timeZone}
          api={api}
        />
      ) : null}
    </div>
  );
}
