"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { AccountPicker } from "@/modules/accounts/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, ProblemNotice, ScreenHeader, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MeDto, TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber } from "@/shared/ui/format/formatters";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import { useToast } from "@/shared/ui/molecules/toast";
import { nowIn, occurredAtOf } from "@/shared/ui/time/when";
import { withTx } from "../detail/tx-href";
import { OthersAccountRow, SummaryRow } from "../record/form-chip";
import { MoneyField } from "../record/form-rows";
import { whenLabel, type When } from "../record/when-label";
import type { SharedExpenseContext } from "../split/shared-context";
import { ifMatchOf } from "./edit-request";
import { paymentEditBodyOf, type PaymentSides } from "./payment-request";

// The record form's own date sheet chunk, loaded on the first tap (ADR 0004).
const DateTimeSheet = dynamic(
  () => import("../record/date-time-sheet").then((module) => module.DateTimeSheet),
  { ssr: false },
);

type Side = "out" | "in";
const MEMBER_OF = { out: "payerMemberId", in: "receivingMemberId" } as const;
const ACCOUNT_OF = { out: "sourceAccountId", in: "destinationAccountId" } as const;

/**
 * Ruling P344 (board 1, "Editar pago"): a payment between members, corrected by anyone who records money. Each side
 * names its member, which the editor may change to another current member (never the other side's, so they stay
 * distinct); the editor's own side picks one of their accounts, another member's side only says whose account it is or
 * that it has none, since only they choose it (S3, D9). It sends only what changed, at the version it was loaded at.
 */
export function EditPaymentForm({
  spaceId,
  tx,
  shared,
  me,
  origin,
  pick,
  api: injected,
}: {
  readonly spaceId: string;
  readonly tx: TransactionDto;
  readonly shared: SharedExpenseContext;
  /** The editor: their formats, and their zone for an untimed payment (P192). */
  readonly me: Pick<MeDto, "preferences" | "timezone">;
  /** The list or home it was opened from; the sheet of this payment is shown there afterwards. */
  readonly origin: string;
  /** P344 (S6): the side whose own-account picker opens at once, when that side is the editor's. */
  readonly pick?: Side;
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const names = useTranslations("members");
  const router = useRouter();
  const toast = useToast();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const { members, meMemberId, myAccounts } = shared;
  const meUserId = members.find((m) => m.id === meMemberId)?.userId ?? "";
  const formats = me.preferences.effective;
  const zone = tx.timeZone ?? me.timezone;
  const currency = currencyOf(tx.amount.currency);
  const [initialWhen] = useState<When>(() => ({
    date: tx.date,
    wall: nowIn(tx.occurredAt ? new Date(tx.occurredAt) : new Date(), zone).wall,
  }));
  const [amount, setAmount] = useState(() =>
    formatNumber(decimalOf(tx.amount.amount, currency.exponent), formats),
  );
  const [sides, setSides] = useState<PaymentSides>({
    payerMemberId: tx.payerMemberId,
    receivingMemberId: tx.receivingMemberId,
    sourceAccountId: tx.sourceAccountId,
    destinationAccountId: tx.destinationAccountId,
  });
  const [when, setWhen] = useState(initialWhen);
  // What is being picked: a side's member or its account, or the date.
  const [open, setOpen] = useState<
    { readonly what: "member" | "account"; readonly side: Side } | "when" | null
  >(pick && tx[MEMBER_OF[pick]] === meMemberId ? { what: "account", side: pick } : null);
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const sheet = withTx(origin, tx.id);
  // P322: a forgiven debt moves no account on either side.
  const accountless = tx.settlementReason === "FORGIVENESS";

  const memberOf = (id: string | null) => members.find((m) => m.id === id);
  const labelOf = (id: string | null) => {
    const member = memberOf(id);
    return member ? memberLabel(member, meUserId, names) : "";
  };
  const today = nowIn(new Date(), zone).date;
  const days = {
    today: t("day.today"),
    yesterday: t("day.yesterday"),
    dayBeforeYesterday: t("day.dayBeforeYesterday"),
  };
  const picking = open !== null && open !== "when" ? open : null;
  const termOf = (side: Side) => t(side === "out" ? "edit.payer" : "edit.receiver");
  const accountTermOf = (side: Side) => t(side === "out" ? "detail.leavesFrom" : "detail.arrivesAt");

  const pickMember = (side: Side, id: string) => {
    if (id !== sides[MEMBER_OF[side]])
      // A side moved to someone else has no account until its member chooses one (S3).
      setSides({ ...sides, [MEMBER_OF[side]]: id, [ACCOUNT_OF[side]]: null });
    setOpen(null);
  };

  const rowsOf = (side: Side) => {
    const member = memberOf(sides[MEMBER_OF[side]]);
    const accountId = sides[ACCOUNT_OF[side]];
    const name = member?.displayName ?? "";
    return (
      <>
        <SummaryRow
          value={labelOf(sides[MEMBER_OF[side]])}
          meta={termOf(side)}
          onClick={() => setOpen({ what: "member", side })}
        />
        {/* A guest pays and is paid outside the app: no account on their side. */}
        {accountless || !member || member.userId === null ? null : member.id === meMemberId ? (
          <SummaryRow
            value={myAccounts.find((a) => a.id === accountId)?.name ?? t("edit.unassigned")}
            meta={accountTermOf(side)}
            onClick={() => setOpen({ what: "account", side })}
          />
        ) : (
          <OthersAccountRow name={name} assigned={accountId !== null} side={side} />
        )}
      </>
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const typed = parseDecimal(amount, formats.numberFormat);
    const whenChanged = JSON.stringify(when) !== JSON.stringify(initialWhen);
    const body = paymentEditBodyOf({
      tx,
      meMemberId,
      current: sides,
      amount: typed === null ? null : minorOf(typed, currency.exponent),
      when: whenChanged
        ? { date: when.date, occurredAt: occurredAtOf(when.date, when.wall, zone), timeZone: zone }
        : null,
    });
    if (Object.keys(body).length === 0) {
      leaveSheet(router, sheet);
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: {
          path: { spaceId, transactionId: tx.id },
          header: { "if-match": ifMatchOf(tx.version) },
        },
        // Ruling P118: the form builds a plain object; the API is the validator of its shape.
        body: body as never,
      });
      if (response.ok) {
        leaveSheet(router, sheet, () => router.refresh());
        toast.show({ message: t("toast.edited") });
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-3 py-3">
      <ScreenHeader
        backHref={sheet}
        title={t("edit.paymentTitle")}
        subtitle={t("edit.paid", {
          payer: memberOf(sides.payerMemberId)?.displayName ?? "",
          receiver: memberOf(sides.receivingMemberId)?.displayName ?? "",
        })}
      />
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <MoneyField
          id="payment-amount"
          label={t("form.amount")}
          currency={tx.amount.currency}
          numberFormat={formats.numberFormat}
          exponent={currency.exponent}
          value={amount}
          onChange={setAmount}
        />
        <div role="group" aria-label={t("form.details")} className="flex flex-col">
          {rowsOf("out")}
          {rowsOf("in")}
          <SummaryRow
            value={whenLabel(when, today, formats, days)}
            meta={t("form.date")}
            onClick={() => {
              setOpened(true);
              setOpen("when");
            }}
            last
          />
        </div>
        {problem ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {t("edit.save")}
        </Button>
      </form>
      <Sheet
        open={picking?.what === "member"}
        onOpenChange={() => setOpen(null)}
        title={picking ? termOf(picking.side) : ""}
      >
        {picking ? (
          <ChoiceGroup
            label={termOf(picking.side)}
            layout="list"
            value={sides[MEMBER_OF[picking.side]] ?? ""}
            onValueChange={(id) => pickMember(picking.side, id)}
            // The other side's member is never offered, so the two stay distinct.
            options={members
              .filter((m) => m.id !== sides[MEMBER_OF[picking.side === "out" ? "in" : "out"]])
              .map((m) => ({ value: m.id, label: labelOf(m.id) }))}
          />
        ) : null}
      </Sheet>
      <AccountPicker
        open={picking?.what === "account"}
        onOpenChange={() => setOpen(null)}
        accounts={myAccounts}
        value={picking ? sides[ACCOUNT_OF[picking.side]] : null}
        onChoose={(id) => picking && setSides({ ...sides, [ACCOUNT_OF[picking.side]]: id })}
        label={picking ? accountTermOf(picking.side) : ""}
      />
      {opened ? (
        <DateTimeSheet
          open={open === "when"}
          onOpenChange={(next) => setOpen(next ? "when" : null)}
          value={when}
          now={nowIn(new Date(), zone)}
          today={today}
          formats={formats}
          onApply={setWhen}
        />
      ) : null}
    </div>
  );
}
