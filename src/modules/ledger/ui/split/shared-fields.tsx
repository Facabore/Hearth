"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { memberLabel } from "@/modules/spaces/ui";
import { Icon } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { Formats } from "@/shared/ui/format/formatters";
import type { SharedExpenseContext } from "./shared-context";
import { isUntouched, splitFailureMessage } from "./split-failure";
import { splitCheckOf, type SplitDraft } from "./split-request";
import { includedIds } from "./split-summary";
import { useDefaultSplit } from "./use-default-split";

// The editor's code (the sheet, the preview, the Radix dialog) loads only when a shared expense's rows are opened.
const SplitSheet = dynamic(() => import("./split-sheet").then((module) => module.SplitSheet), {
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
  /** The expense in one line ("Mercado · $ 300.000 · Household"), shown under the sheet's title. */
  readonly title: string;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly api: Api;
  readonly error?: string | undefined;
  /** Whether the plan's split (HU-E6-08) is asked for and offered; an edit starts from the saved split and has none (P192). */
  readonly defaultSplit?: boolean;
  /** Issue #171: the division row is folded under Más opciones; who paid stays on screen. */
  readonly splitHidden?: boolean;
  /** The division row's id, for the Más opciones toggle's aria-controls. */
  readonly splitId?: string;
}

const rowClass =
  "flex min-h-14 items-center justify-between gap-3 rounded-xl border border-field bg-surface px-4 text-left";

/**
 * HU-E9-06, the SharedExpense artboard: two rows, who paid and how it is split, both opening the split sheet. The
 * plan's default split is preselected until the person picks a method or a participant (P167). Issue #171: the record
 * form folds the division row under Más opciones (`splitHidden`), never who paid.
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
  defaultSplit: offerPlan = true,
  splitHidden = false,
  splitId,
}: SharedFieldsProps) {
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
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
            : memberIds,
      });
    // The plan's split is the API's to offer: without an answer the form is back to equal parts (P167).
    else if (defaultSplit.status === "none" && draft.method === "BY_ALLOCATION")
      onChange({ ...draft, method: "EQUAL", selected: memberIds });
    // `memberIds` is derived from the context on every render; the draft and the answer are what trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSplit, draft, onChange]);

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
    payer.kind === "ME" ? context.myAccounts.find((a) => a.id === payer.accountId)?.name : undefined;
  const paid =
    payer.kind === "FUND"
      ? t("paidBy", { payer: context.funds.find((f) => f.id === payer.accountId)?.name ?? "" })
      : payer.kind === "GUEST"
        ? t("paidBy", { payer: label(payer.memberId) })
        : account
          ? // A shared space holds only funds: a member pays from a personal account of their own (S7).
            t("paidFromMine", { account })
          : t("paidBy", { payer: label(payer.memberId) });

  const show = () => {
    setOpened(true);
    setOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={show} className={rowClass}>
          <span className="font-medium text-ink">{paid}</span>
          <Icon name="chevronRight" size={20} />
        </button>
        <div id={splitId} hidden={splitHidden} className="flex flex-col gap-1">
          <button
            type="button"
            onClick={show}
            aria-describedby={error ? "record-split-error" : undefined}
            className={rowClass}
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-muted">{t("split")}</span>
              <span className="font-medium break-words text-ink">{summary}</span>
            </span>
            <Icon name="chevronRight" size={20} />
          </button>
          {error ? (
            <p id="record-split-error" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {opened ? (
        <SplitSheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          members={context.members}
          meUserId={meUserId}
          myAccounts={context.myAccounts}
          funds={context.funds}
          draft={draft}
          onChange={onChange}
          amount={amount}
          currency={currency}
          formats={formats}
          defaultSplit={defaultSplit}
        />
      ) : null}
    </>
  );
}
