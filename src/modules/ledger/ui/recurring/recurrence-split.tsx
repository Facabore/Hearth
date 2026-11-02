"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { memberLabel } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import { formatPercent, type Formats } from "@/shared/ui/format/formatters";
import type { SharedExpenseContext } from "../split/shared-context";
import { isUntouched, splitFailureMessage } from "../split/split-failure";
import { splitCheckOf, type SplitDraft } from "../split/split-request";
import { includedIds } from "../split/split-summary";
import { useDefaultSplit } from "../split/use-default-split";

// The record form's own editor, in its own chunk: it loads only once who paid or the division is opened.
const SplitSheet = dynamic(() => import("../split/split-sheet").then((module) => module.SplitSheet), {
  ssr: false,
});

/** A share of the whole as a percent with at most two decimals ("40", "33.33"), for `formatPercent`. */
const percentOf = (part: bigint, whole: bigint): string => {
  const hundredths = (part * 10_000n) / whole;
  const fraction = hundredths % 100n;
  return fraction === 0n
    ? String(hundredths / 100n)
    : `${hundredths / 100n}.${String(fraction).padStart(2, "0")}`;
};

export interface RecurrenceSplit {
  /** Who pays, as board E9-09 02's "Pagó" row reads it: "Ana · Bancolombia", a fund, or a guest. */
  readonly payer: string;
  /** The division in one line: "Según el plan · Ana 40 % / Juan 60 %", or what is wrong with it. */
  readonly parts: string;
  readonly open: () => void;
  /** The split sheet, mounted once it was first opened. */
  readonly sheet: ReactNode;
}

/**
 * HU-E9-06 for a recurrence (S7): the record form's split, drawn as board E9-09 02 draws it. Who paid is a row of the
 * details card and the division is summed up under Más opciones, so the record form's two-row `SharedFields` is
 * composed here from its parts: the same default split (P167), the same check and failure sentence, the same sheet.
 */
export const useRecurrenceSplit = ({
  enabled,
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
}: {
  /** A shared expense being defined; otherwise nothing is asked and the hook answers null. */
  readonly enabled: boolean;
  readonly context: SharedExpenseContext | undefined;
  readonly draft: SplitDraft | null;
  readonly onChange: (draft: SplitDraft) => void;
  /** Minor units of the amount being typed, or null while it is empty, unreadable or zero. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  readonly title: string;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly api: Api;
}): RecurrenceSplit | null => {
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const live = enabled && context !== undefined && draft !== null;
  const defaultSplit = useDefaultSplit({ api, spaceId, categoryId, date, amount, enabled: live });
  const members = context?.members ?? [];
  const memberIds = members.map((member) => member.id);

  // The plan's split until the person picks a method (P167), as the record form's SharedFields applies it.
  useEffect(() => {
    if (!live || draft === null || draft.chosen) return;
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
    else if (defaultSplit.status === "none" && draft.method === "BY_ALLOCATION")
      onChange({ ...draft, method: "EQUAL", selected: memberIds });
    // `memberIds` is derived from the context on every render; the draft and the answer are what trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, defaultSplit, draft, onChange]);

  if (!live || context === undefined || draft === null) return null;
  const meUserId = members.find((m) => m.id === context.meMemberId)?.userId ?? "";
  const label = (id: string) => {
    const member = members.find((m) => m.id === id);
    return member ? memberLabel(member, meUserId, names) : "";
  };
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? "";

  const allocation = defaultSplit.status === "ready" ? defaultSplit.shares : null;
  const check = splitCheckOf(draft, {
    amount,
    currency,
    numberFormat: formats.numberFormat,
    memberIds,
    allocation,
  });
  const method = t(`methods.${draft.method}`);
  const included = includedIds(draft, memberIds, allocation);
  const who =
    included.length === 1
      ? t("with.one", { a: nameOf(included[0]!) })
      : included.length === 2
        ? t("with.two", { a: nameOf(included[0]!), b: nameOf(included[1]!) })
        : t("with.many", { count: included.length });
  const whole = check?.ok ? check.shares.reduce((sum, share) => sum + BigInt(share.amount), 0n) : 0n;
  const parts =
    check && !check.ok && !isUntouched(check, draft)
      ? splitFailureMessage(check, t, { currency, formats, nameOf: label })
      : check?.ok && whole > 0n
        ? `${method} · ${check.shares
            .filter((share) => BigInt(share.amount) > 0n)
            .map(
              (share) =>
                `${nameOf(share.memberId)} ${formatPercent(percentOf(BigInt(share.amount), whole), formats)}`,
            )
            .join(" / ")}`
        : included.length === 0
          ? method
          : `${method} · ${who}`;

  const { payer } = draft;
  const account =
    payer.kind === "ME" ? context.myAccounts.find((a) => a.id === payer.accountId)?.name : undefined;
  const payerText =
    payer.kind === "FUND"
      ? (context.funds.find((f) => f.id === payer.accountId)?.name ?? "")
      : payer.kind === "GUEST"
        ? label(payer.memberId)
        : [nameOf(payer.memberId), account].filter(Boolean).join(" · ");

  return {
    payer: payerText,
    parts,
    open: () => {
      setOpened(true);
      setOpen(true);
    },
    sheet: opened ? (
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
    ) : null,
  };
};
