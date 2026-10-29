"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlsFor, memberLabel } from "@/modules/spaces/ui";
import { Avatar, Button, SymbolIcon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, BalancesDto, MemberDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";
import { SettleUpSheet } from "./settle-up-sheet";
import { prefillOf, type SettlementDraft } from "./settlement-request";

/**
 * HU-E9-07, the Balances artboard as `/spaces/{spaceId}/balances` (the Saldos tab, ruling P173): the viewer's own
 * net, the API's settle-up suggestions and every current member's net. Only the header speaks to the viewer; the
 * suggestions and the members always use names, so the story's sentences read the same from every seat. Each member
 * row links to a history page that is rarely opened, so the links do not prefetch it (one request per member).
 *
 * Settling up (rulings P174 and P175): "Saldar" on a suggestion and "Saldar otro monto" only fill in the settle-up
 * sheet; a payment is recorded when the person saves it. `settle` (the guest sheet's link) opens the sheet for that
 * member. A viewer who cannot record money reads the balances without either control.
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
  const tHome = useTranslations("home");
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  const netOf = (memberId: string) =>
    balances.find((balance) => balance.memberId === memberId)?.net ?? {
      amount: "0",
      currency: space.currency,
    };
  const viewer = members.find((member) => member.userId === meUserId);
  const mine = viewer ? netOf(viewer.id) : netOf("");
  const state = netState(mine);

  const canSettle = viewer !== undefined && controlsFor(space.role, space.kind).recordMoney;
  const prefill = (suggestion: SuggestionDto | null, payerMemberId?: string): SettlementDraft =>
    prefillOf({
      suggestion,
      payerMemberId,
      meMemberId: viewer?.id ?? "",
      currency: space.currency,
      numberFormat: formats.numberFormat,
    });
  // The sheet is mounted only while it is open, so each opening starts from its own prefill and forgets the last attempt.
  const [settling, setSettling] = useState<SettlementDraft | null>(() =>
    canSettle && settle && members.some((member) => member.id === settle)
      ? prefill(suggestions.find((s) => s.payerMemberId === settle) ?? null, settle)
      : null,
  );

  return (
    <div className="flex flex-col gap-3 pb-3">
      <h1 className="sr-only">{t("title")}</h1>
      <section aria-label={t("yours", { space: space.name })} className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 pt-3 text-[15px] text-muted [overflow-wrap:anywhere]">
            {t("yours", { space: space.name })}
          </span>
          {/* N10: the members are one tap from the balances, not only in the profile sheet. */}
          <Link
            href={`/spaces/${space.id}/members`}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink"
          >
            <SymbolIcon name="users" size={18} />
            {tHome("members")}
          </Link>
        </div>
        <span
          className={`text-4xl font-semibold tabular-nums ${state === "owes" ? "text-owe" : state === "owed" ? "text-accent" : "text-ink"}`}
        >
          {t(`you.${state}`, { amount: formatMoney(absolute(mine), formats) })}
        </span>
      </section>
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
            <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
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
                    className="flex min-h-row-lg items-center gap-3 px-3 py-1.5"
                  >
                    <Avatar name={payer} />
                    <span className="min-w-0 flex-1 text-base tabular-nums [overflow-wrap:anywhere]">
                      {sentence}
                    </span>
                    {canSettle ? (
                      <Button
                        variant="ghost"
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
            <Button variant="secondary" className="shrink-0" onClick={() => setSettling(prefill(null))}>
              {t("record")}
            </Button>
          ) : null}
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {members.map((member) => {
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
                  className="flex min-h-12 items-center gap-3 px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] text-ink">{name}</span>
                  <span
                    className={`text-[15px] font-semibold tabular-nums ${memberState === "owes" ? "text-owe" : memberState === "owed" ? "text-accent" : "text-muted"}`}
                  >
                    {sentence}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
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
          members={members}
          meUserId={meUserId}
          myAccounts={myAccounts}
          suggestions={suggestions}
          initial={settling}
          formats={formats}
          timeZone={timeZone}
          api={api}
        />
      ) : null}
    </div>
  );
}
