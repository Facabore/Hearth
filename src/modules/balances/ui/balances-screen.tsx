"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { preferredAccountId, readLastAccount } from "@/modules/ledger/ui";
import { controlsFor, memberLabel } from "@/modules/spaces/ui";
import { Button, Icon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  BalancesDto,
  MemberDto,
  MoneyDto,
  SpaceDto,
  SuggestionDto,
} from "@/shared/ui/api/dto";
import {
  Amount,
  AMOUNT_ROW,
  AMOUNT_ROW_AMOUNT,
  AMOUNT_ROW_LABEL,
  AmountText,
} from "@/shared/ui/atoms/amount";
import { HeroAmount } from "@/shared/ui/atoms/hero-amount";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { absolute, memberSentence, netsOf, netState } from "./net-state";
import { prefillOf, type SettlementDraft } from "./settlement-prefill";

// The settle-up sheet's code, its form and the Radix dialog under it, load only when the sheet opens (ADR 0004: the
// route's script budget), as the transaction sheet's do (P189).
const SettleUpSheet = dynamic(() => import("./settle-up-sheet").then((module) => module.SettleUpSheet), {
  ssr: false,
});

/**
 * An open settle-up sheet: its draft, whether a suggestion filled it in, and the account this browser last paid from,
 * read when the sheet opens (#219). The screen reads it so the lazy sheet's chunk carries no copy of the record form's
 * account code (#296).
 */
interface Settling {
  readonly draft: SettlementDraft;
  readonly suggested: boolean;
  readonly lastAccountId: string | null;
}

/** Ruling P342: the heading of one currency's suggestions or members. */
const CURRENCY_HEADING = "pt-2 text-[13px] font-semibold text-muted";

/** Ruling P342: every currency anyone owes in, the space's first, then by ISO code as the API orders them. */
const currenciesOf = (
  spaceCurrency: string,
  balances: BalancesDto["members"],
  suggestions: readonly SuggestionDto[],
): string[] => {
  const others = new Set<string>();
  for (const balance of balances) for (const net of netsOf(balance)) others.add(net.currency);
  for (const suggestion of suggestions) others.add(suggestion.amount.currency);
  others.delete(spaceCurrency);
  return [spaceCurrency, ...[...others].sort()];
};

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
 * Ruling P272 (board 01): "Saldar otro monto" is a text link and each member row ends in a chevron. The board's strip
 * with the viewer's balance in another space is not drawn: the API answers balances one space at a time.
 *
 * Ruling P324 (medium density, board "Saldos"): one hero with the viewer's figure once and its direction in words under
 * it; each suggestion is one action line between hairlines, not a card; each member is a flat row with a word for the
 * direction and a signed amount, so the colour never carries it alone. The board's "¿Cómo se calcula?" link is not
 * drawn: there is no help text for it to open yet.
 *
 * Ruling P342 (S4): debts never convert, so with more than one currency the suggestions and the members are grouped by
 * currency under a heading each ("En COP", "En USD"), the space's first; each suggestion is in its own currency, and a
 * member's row in another currency opens that currency's history. With one currency the screen is as it was.
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
  personalSpaceId,
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
  /** The viewer's personal space, where Saldar's "Crear una cuenta" creates one (P342, owner decision). */
  readonly personalSpaceId?: string;
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
  const currencies = currenciesOf(space.currency, balances, suggestions);
  const several = currencies.length > 1;
  /** P342: a member's net in one currency, the space's from `net` as before, another's from `nets` (zero when absent). */
  const netIn = (memberId: string, currency: string): MoneyDto => {
    if (currency === space.currency) return netOf(memberId);
    const balance = balances.find((one) => one.memberId === memberId);
    return (
      (balance ? netsOf(balance) : []).find((net) => net.currency === currency) ?? { amount: "0", currency }
    );
  };

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
    lastAccountId: readLastAccount(),
  });
  // The sheet is mounted only while it is open, so each opening starts from its own prefill and forgets the last attempt.
  const [settling, setSettling] = useState<Settling | null>(() =>
    canSettle && settle && members.some((member) => member.id === settle)
      ? prefill(suggestions.find((s) => s.payerMemberId === settle) ?? null, settle)
      : null,
  );

  const suggestionList = (list: readonly SuggestionDto[]) => (
    <ol className="divide-y divide-line border-y border-line">
      {list.map((suggestion) => {
        const payer = names.get(suggestion.payerMemberId) ?? "";
        const receiver = names.get(suggestion.receivingMemberId) ?? "";
        const amount = formatMoney(suggestion.amount, formats);
        const sentence = t("owes", { payer, receiver, amount });
        return (
          <li
            key={`${suggestion.payerMemberId}-${suggestion.receivingMemberId}-${suggestion.amount.currency}`}
            className="flex min-h-row-lg flex-wrap items-center gap-x-3 py-1.5"
          >
            {/* P335: the names wrap and the amount stays whole; when the sentence cannot keep the amount
                beside Saldar, Saldar moves under it. */}
            <span className="flex-[1_1_12rem] text-base text-ink tabular-nums [overflow-wrap:anywhere]">
              <AmountText text={sentence} />
            </span>
            {canSettle ? (
              <Button
                variant="ghost"
                size="compact"
                className="-mr-2 ml-auto shrink-0"
                aria-label={t("settle.suggestion", { payer, receiver, amount })}
                onClick={() => setSettling(prefill(suggestion))}
              >
                {t("settle.action")}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );

  const memberList = (rows: readonly MemberDto[], currency: string) => (
    <ul className="divide-y divide-line empty:hidden">
      {rows.map((member) => {
        const net = netIn(member.id, currency);
        const memberState = netState(net);
        const sentence = memberSentence(net, formats, t);
        const name = memberLabel(member, meUserId, tMembers);
        // P324: the direction in words ("recibe", "paga") and a signed amount; the colour only repeats them, in the
        // ink tone of --owe, which keeps AA on the page background now that the rows have no card.
        const word = t(`state.${memberState}`);
        return (
          <li key={member.id}>
            <Link
              href={`/spaces/${space.id}/members/${member.id}/history${currency === space.currency ? "" : `?currency=${currency}`}`}
              aria-label={t("member.link", { name, sentence })}
              prefetch={false}
              className="flex min-h-row-lg items-center gap-2 py-1.5"
            >
              {/* P335: the amount sits beside the name while they fit, and moves whole under it when not. */}
              <span className={`${AMOUNT_ROW} min-w-0 flex-1 items-center`}>
                <span className={`${AMOUNT_ROW_LABEL} flex flex-col`}>
                  <span className="font-medium [overflow-wrap:anywhere] text-ink">{name}</span>
                  <span className="text-[13px] text-muted">{word}</span>
                </span>
                <Amount
                  className={`${AMOUNT_ROW_AMOUNT} font-semibold ${memberState === "owes" ? "text-owe-ink" : memberState === "owed" ? "text-accent" : "text-muted"}`}
                >
                  {formatSignedMoney(net, formats)}
                </Amount>
              </span>
              {/* Board 01: the chevron says the row opens the member's history. */}
              <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3 pb-3">
      <h1 className="sr-only">{t("title")}</h1>
      {/* P324: the hero states the viewer's figure once, in ink, and its direction in words under it. The members are one
          tap away in the profile sheet and on Inicio, so Saldos has no Miembros button of its own. */}
      <section aria-label={t("yours", { space: space.name })} className="flex flex-col pt-1">
        <span className="min-w-0 text-[15px] text-muted [overflow-wrap:anywhere]">
          {t("yours", { space: space.name })}
        </span>
        {/* P335: one line at any width, font or number of digits; the figure scales with the hero's width. */}
        <HeroAmount
          data-testid="balances-hero-amount"
          amount={formatMoney(absolute(mine), formats)}
          size="2.25rem"
          className="leading-tight font-semibold text-ink"
        />
        <span className="text-[15px] text-muted">{t(`you.${state}`)}</span>
      </section>
      {personal ? (
        <p className="border-y border-line py-3 text-base text-muted">
          {t("personalNote", { space: space.name })}
        </p>
      ) : (
        <>
          {/* P324: the suggestions are the screen's action lines, between hairlines. Their heading is for assistive
              technology only: the board shows the lines straight under the hero. */}
          <section aria-labelledby="balances-suggestions" className="flex flex-col gap-2">
            <h2 id="balances-suggestions" className="sr-only">
              {t("suggestions")}
            </h2>
            {suggestions.length === 0 ? (
              <p className="border-y border-line py-3 text-base text-muted">
                {t("allSettled", { space: space.name })}
              </p>
            ) : (
              <>
                {several
                  ? currencies.map((currency) => {
                      const list = suggestions.filter((one) => one.amount.currency === currency);
                      return list.length === 0 ? null : (
                        <Fragment key={currency}>
                          <h3 className={CURRENCY_HEADING}>{t("inCurrency", { currency })}</h3>
                          {suggestionList(list)}
                        </Fragment>
                      );
                    })
                  : suggestionList(suggestions)}
                <p className="text-[13px] text-muted">{t("suggestionsNote")}</p>
              </>
            )}
          </section>
          <section aria-labelledby="balances-members" className="flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <h2 id="balances-members" className="min-w-0 text-[15px] font-semibold text-ink">
                {t("members")}
              </h2>
              {canSettle ? (
                <Button
                  variant="ghost"
                  size="compact"
                  className="-mr-2 shrink-0"
                  onClick={() => setSettling(prefill(null))}
                >
                  {t("record")}
                </Button>
              ) : null}
            </div>
            {several
              ? currencies.map((currency) => {
                  const rows =
                    currency === space.currency
                      ? listed
                      : listed.filter((member) => BigInt(netIn(member.id, currency).amount) !== 0n);
                  return rows.length === 0 ? null : (
                    <Fragment key={currency}>
                      <h3 className={CURRENCY_HEADING}>{t("inCurrency", { currency })}</h3>
                      {memberList(rows, currency)}
                    </Fragment>
                  );
                })
              : memberList(listed, space.currency)}
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
          lastAccountId={settling.lastAccountId}
          preferredAccountId={(currency) =>
            preferredAccountId(
              myAccounts.filter((account) => account.balance.currency === currency),
              settling.lastAccountId,
            )
          }
          formats={formats}
          timeZone={timeZone}
          // P342 (owner): a new account in the personal space comes back to Saldar, with the same payer.
          newAccountHref={
            personalSpaceId
              ? (payer) =>
                  withReturnTo(
                    `/spaces/${personalSpaceId}/accounts/new`,
                    `/spaces/${space.id}/balances${payer ? `?settle=${encodeURIComponent(payer)}` : ""}`,
                  )
              : undefined
          }
          api={api}
        />
      ) : null}
    </div>
  );
}
