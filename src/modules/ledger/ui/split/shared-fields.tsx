"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { memberLabel } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { OthersAccountRow, SummaryRow } from "../record/form-chip";
import { defaultParticipantIds, type SharedExpenseContext } from "./shared-context";
import { isUntouched, splitFailureMessage } from "./split-failure";
import { splitCheckOf, type SplitDraft } from "./split-request";
import { includedIds } from "./split-summary";
import { useDefaultSplit } from "./use-default-split";
import { useWhoPaidLine } from "./who-paid-line";

// The sheet's code (who paid, for whom, the preview, the Radix dialog, adding guests) loads only when its row is opened.
const WhoPaidSheet = dynamic(() => import("./who-paid-sheets").then((module) => module.SharedWhoPaidSheet), {
  ssr: false,
});

export interface SharedFieldsProps {
  readonly context: SharedExpenseContext;
  readonly draft: SplitDraft;
  readonly onChange: (draft: SplitDraft) => void;
  /** Minor units of the amount being typed, or null while it is empty, unreadable or zero. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  /** The expense in one line ("Mercado · 300.000 COP · Household"), shown under the sheets' titles. */
  readonly title: string;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly api: Api;
  /** The split's problem, shown under the row. */
  readonly error?: string | undefined;
  /** Who paid's problem (the account it was paid from), shown under the row. */
  readonly payerError?: string | undefined;
  /** Whether the plan's split (HU-E6-08) is asked for and offered; an edit starts from the saved split and has none (P192). */
  readonly defaultSplit?: boolean;
  /**
   * D26, P328: a new expense may be paid for the fund, and the line's payers propose it: a recorder who usually pays
   * the line its category consumes starts as "pagaste por el fondo" from their account, in a space with a fund.
   */
  readonly forFund?: boolean;
  /** Ruling P337: why "Desde" holds the account it does ("Bancolombia: con la que sueles pagar Gas."), or null. */
  readonly fromHint?: string | null;
}

/**
 * HU-E9-06 as ruling P333 draws it (board "Registrar: una fila"): one flat summary row, "Pagaste tú con Bancolombia ·
 * para Juan y Ana" over "Quién pagó y para quién", opening the sheet that holds both. The plan's default split is
 * preselected until the person picks a method or a participant (P167).
 */
export function SharedFields({
  context,
  draft,
  onChange,
  amount,
  currency,
  formats,
  title,
  spaceId,
  categoryId,
  date,
  api,
  error,
  payerError,
  defaultSplit: offerPlan = true,
  forFund = false,
  fromHint = null,
}: SharedFieldsProps) {
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const whoPaidLine = useWhoPaidLine();
  const defaultSplit = useDefaultSplit({ api, spaceId, categoryId, date, amount, enabled: offerPlan });
  const memberIds = context.members.map((member) => member.id);
  const meUserId = context.members.find((m) => m.id === context.meMemberId)?.userId ?? "";
  const who = useTranslations("ledger.who");
  // The sheet's names: the recorder is "Tú" (P333).
  const label = (id: string) => {
    const member = context.members.find((m) => m.id === id);
    if (id === context.meMemberId) return who("you");
    return member ? memberLabel(member, meUserId, names) : "";
  };

  useEffect(() => {
    if (draft.chosen) return;
    if (defaultSplit.status === "ready" && defaultSplit.method !== draft.method)
      onChange({
        ...draft,
        method: defaultSplit.method,
        selected:
          defaultSplit.method === "BY_ALLOCATION"
            ? (defaultSplit.shares?.filter((s) => BigInt(s.amount) > 0n).map((s) => s.memberId) ??
              draft.selected)
            : defaultParticipantIds(context.members),
      });
    // The plan's split is the API's to offer: without an answer the form is back to equal parts (P167), among
    // every member but the VIEWERs (P293).
    else if (defaultSplit.status === "none" && draft.method === "BY_ALLOCATION")
      onChange({ ...draft, method: "EQUAL", selected: defaultParticipantIds(context.members) });
    // The context is derived on every render; the draft and the answer are what trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSplit, draft, onChange]);

  // D26, P328: until the person picks who paid, the line's payers propose it. A recorder who usually pays the line
  // pays for the fund from the account they would pay from; once the category no longer says so, they pay themselves.
  const fund = context.funds[0];
  useEffect(() => {
    if (!forFund || draft.payerChosen || fund === undefined) return;
    const { payer } = draft;
    const pays =
      defaultSplit.status === "ready" &&
      // D26 (S4, S5): only a fund line is paid for the fund; on any other line its payers pay it themselves.
      defaultSplit.lineFunding === "SHARED_FUND" &&
      (defaultSplit.payerMemberIds ?? []).includes(context.meMemberId);
    if (pays && payer.kind === "ME")
      onChange({ ...draft, payer: { ...payer, kind: "FOR_FUND", fundAccountId: fund.id } });
    else if (!pays && payer.kind === "FOR_FUND")
      onChange({ ...draft, payer: { kind: "ME", memberId: payer.memberId, accountId: payer.accountId } });
    // The context is derived on every render; the draft and the answer are what trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSplit, draft, onChange, forFund, fund?.id]);

  const allocation = defaultSplit.status === "ready" ? defaultSplit.shares : null;
  const check = splitCheckOf(draft, {
    amount,
    currency,
    numberFormat: formats.numberFormat,
    memberIds,
    allocation,
  });
  // P333: one line saying who paid and whom it was for; a split that does not add up says what is missing instead.
  const included = includedIds(draft, memberIds, allocation);
  const myShare = check?.ok ? check.shares.find((share) => share.memberId === context.meMemberId) : undefined;
  const { payer } = draft;
  const account =
    payer.kind === "ME" || payer.kind === "FOR_FUND"
      ? context.myAccounts.find((a) => a.id === payer.accountId)?.name
      : undefined;
  const fundName = (id: string) => context.funds.find((f) => f.id === id)?.name ?? "";
  const nameOf = (id: string) => context.members.find((m) => m.id === id)?.displayName ?? "";
  const line = whoPaidLine({
    payer:
      payer.kind === "ME"
        ? { kind: "ME", account: account ?? null }
        : payer.kind === "FOR_FUND"
          ? { kind: "FOR_FUND", fund: fundName(payer.fundAccountId), account: account ?? null }
          : payer.kind === "FUND"
            ? { kind: "OTHER", name: fundName(payer.accountId) }
            : { kind: "OTHER", name: nameOf(payer.memberId), owesThem: true },
    meIncluded: included.includes(context.meMemberId),
    others: included.filter((id) => id !== context.meMemberId).map(nameOf),
    myShare: myShare ? formatMoney({ amount: myShare.amount, currency }, formats) : null,
  });
  const value =
    check === null || check.ok || isUntouched(check, draft)
      ? line
      : splitFailureMessage(check, t, { currency, formats, nameOf: label });
  const problem = error ?? payerError;

  return (
    <>
      <SummaryRow
        value={value}
        meta={t("title")}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        errorId={problem ? "record-split-error" : undefined}
      />
      {/* P344 (board 3): another member's account, kept and theirs alone to change, so it is no button. */}
      {payer.kind === "MEMBER" && payer.accountId ? (
        <OthersAccountRow name={nameOf(payer.memberId)} assigned />
      ) : null}
      {problem ? (
        <p id="record-split-error" className="pt-1 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {opened ? (
        <WhoPaidSheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          context={context}
          api={api}
          meUserId={meUserId}
          draft={draft}
          onChange={onChange}
          amount={amount}
          currency={currency}
          formats={formats}
          defaultSplit={defaultSplit}
          forFund={forFund}
          fromHint={fromHint}
        />
      ) : null}
    </>
  );
}
