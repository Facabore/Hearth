"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { memberLabel } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import type { Formats } from "@/shared/ui/format/formatters";
import { SummaryRow } from "../record/form-chip";
import { defaultParticipantIds, type SharedExpenseContext } from "./shared-context";
import { isUntouched, splitFailureMessage } from "./split-failure";
import { splitCheckOf, type SplitDraft } from "./split-request";
import type { SharedSheet } from "./split-sheet";
import { includedIds } from "./split-summary";
import { useDefaultSplit } from "./use-default-split";

// The sheets' code (the split, who paid, the preview, the Radix dialog, adding guests) loads only when one of a shared
// expense's rows is opened.
const SplitSheets = dynamic(() => import("./split-sheet").then((module) => module.SharedSplitSheet), {
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
  /** The expense in one line ("Mercado · $ 300.000 · Household"), shown under the sheets' titles. */
  readonly title: string;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly api: Api;
  /** The split's problem, shown under its row. */
  readonly error?: string | undefined;
  /** Who paid's problem (the account it was paid from), shown under its row. */
  readonly payerError?: string | undefined;
  /** Whether the plan's split (HU-E6-08) is asked for and offered; an edit starts from the saved split and has none (P192). */
  readonly defaultSplit?: boolean;
  /**
   * D26, P328: a new expense may be paid for the fund, and the line's payers propose it: a recorder who usually pays
   * the line its category consumes starts as "pagaste por el fondo" from their account, in a space with a fund.
   */
  readonly forFund?: boolean;
}

/**
 * HU-E9-06, the SharedExpense artboard as ruling P324 draws it (board "Registrar gasto"): two flat summary rows, how it
 * is split ("Cómo se divide") and who paid with the account ("Quién pagó"), each opening its own sheet. The plan's
 * default split is preselected until the person picks a method or a participant (P167).
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
}: SharedFieldsProps) {
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const [opened, setOpened] = useState(false);
  const [sheet, setSheet] = useState<SharedSheet>(null);
  const defaultSplit = useDefaultSplit({ api, spaceId, categoryId, date, amount, enabled: offerPlan });
  const memberIds = context.members.map((member) => member.id);
  const meUserId = context.members.find((m) => m.id === context.meMemberId)?.userId ?? "";
  const label = (id: string) => {
    const member = context.members.find((m) => m.id === id);
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
  // U2: one line saying who is included and how it is divided; a split that does not add up says what is missing.
  const included = includedIds(draft, memberIds, allocation);
  const nameOf = (id: string) => context.members.find((m) => m.id === id)?.displayName ?? "";
  const who =
    included.length === 1
      ? t("with.one", { a: nameOf(included[0]!) })
      : included.length === 2
        ? t("with.two", { a: nameOf(included[0]!), b: nameOf(included[1]!) })
        : t("with.many", { count: included.length });
  const how = draft.method === "EQUAL" && included.length === 2 ? t("how.HALF") : t(`how.${draft.method}`);
  const overview = included.length === 0 ? t(`methods.${draft.method}`) : t("line", { who, how });
  const summary =
    check === null || check.ok || isUntouched(check, draft)
      ? overview
      : splitFailureMessage(check, t, { currency, formats, nameOf: label });

  const { payer } = draft;
  const account =
    payer.kind === "ME" || payer.kind === "FOR_FUND"
      ? context.myAccounts.find((a) => a.id === payer.accountId)?.name
      : undefined;
  // Ruling P291 (board E9-06 · 01): "Pagó Ana desde Bancolombia", the recorder named too; ruling P324 drops the bold, so
  // the row is one plain line over its meta.
  const b = (chunks: ReactNode) => chunks;
  const paid =
    payer.kind === "FOR_FUND"
      ? t.rich("paidForFund", {
          b,
          fund: context.funds.find((f) => f.id === payer.fundAccountId)?.name ?? "",
          account: account ?? "",
        })
      : payer.kind === "FUND"
        ? t.rich("paidBy", { b, payer: context.funds.find((f) => f.id === payer.accountId)?.name ?? "" })
        : payer.kind === "GUEST"
          ? t.rich("paidBy", { b, payer: label(payer.memberId) })
          : account
            ? // A shared space holds only funds: a member pays from a personal account of their own (S7).
              t.rich("paidFrom", { b, payer: nameOf(payer.memberId), account })
            : t.rich("paidBy", { b, payer: label(payer.memberId) });

  const show = (which: NonNullable<SharedSheet>) => {
    setOpened(true);
    setSheet(which);
  };

  return (
    <>
      {/* The row is still named "División …" for screen readers; "Cómo se divide" under it says the same. */}
      <SummaryRow
        label={t("split")}
        value={summary}
        meta={t("method")}
        onClick={() => show("split")}
        errorId={error ? "record-split-error" : undefined}
      />
      {error ? (
        <p id="record-split-error" className="pt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {/* "Pagó Ana desde Bancolombia" says what it is, so "Quién pagó" under it is not read again. */}
      <SummaryRow
        label=""
        value={paid}
        meta={t("payerTitle")}
        onClick={() => show("payer")}
        errorId={payerError ? "record-payer-error" : undefined}
      />
      {payerError ? (
        <p id="record-payer-error" className="pt-1 text-sm text-danger">
          {payerError}
        </p>
      ) : null}
      {opened ? (
        <SplitSheets
          sheet={sheet}
          onSheetChange={setSheet}
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
        />
      ) : null}
    </>
  );
}
