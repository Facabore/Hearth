"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useIdempotencyKey } from "@/modules/ledger/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, Icon, NumberField, ProblemNotice, Sheet } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn, occurredAtOf } from "@/shared/ui/time/when";
import {
  settlementFieldOf,
  settlementRequestOf,
  type SettlementDraft,
  type SettlementField,
} from "./settlement-request";

/** A chip's label wraps inside the screen however long a stored name is (320 px). */
const wrapped = (text: string): ReactNode => (
  <span className="block max-w-full py-2.5 text-left [overflow-wrap:anywhere]">{text}</span>
);

/** The time fields never decide the draft's key: the clock moves every minute, the person's choices do not. */
const NO_TIME = { date: "", occurredAt: "", timeZone: "" } as const;

export interface SettleUpSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name" | "currency">;
  /** The current members, guests included. */
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  /** The accounts the viewer owns: the only ones a payment may leave from or arrive in (D9). */
  readonly myAccounts: readonly AccountDto[];
  readonly suggestions: readonly SuggestionDto[];
  /** The draft the sheet starts from; the screen mounts the sheet only while it is open, so each opening is new. */
  readonly initial: SettlementDraft;
  readonly formats: Formats;
  /** The zone the payment is dated in; by default the browser's. */
  readonly timeZone?: string;
  readonly api?: Api;
}

/**
 * HU-E9-07, the SettleUp artboard (rulings P174 and P175): who pays whom and how much, prefilled from a suggestion or
 * empty. It records a payment now, in the browser's zone, with one `Idempotency-Key` per draft; a guest pays outside
 * the app, so no account is offered on their side.
 */
export function SettleUpSheet({
  open,
  onOpenChange,
  space,
  members,
  meUserId,
  myAccounts,
  suggestions,
  initial,
  formats,
  timeZone,
  api: injected,
}: SettleUpSheetProps) {
  const t = useTranslations("balances.settle");
  const form = useTranslations("ledger.form");
  const errors = useTranslations("errors");
  const names = useTranslations("members");
  const toasts = useTranslations("balances.toast");
  const toast = useToast();
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [draft, setDraft] = useState<SettlementDraft>(initial);
  const [unbuilt, setUnbuilt] = useState<SettlementField | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const currency = currencyOf(space.currency);
  const meMemberId = members.find((member) => member.userId === meUserId)?.id ?? "";
  const payer = members.find((member) => member.id === draft.payerMemberId);
  const receiver = members.find((member) => member.id === draft.receivingMemberId);
  const request = (when: { date: string; occurredAt: string; timeZone: string }) =>
    settlementRequestOf(draft, {
      currency: space.currency,
      numberFormat: formats.numberFormat,
      meMemberId,
      when,
    });
  const preview = request(NO_TIME);
  const { key, renew } = useIdempotencyKey(preview.ok ? JSON.stringify(preview.body) : "");

  const debt =
    payer && receiver && payer.id !== receiver.id
      ? suggestions.find(
          (suggestion) =>
            suggestion.payerMemberId === payer.id && suggestion.receivingMemberId === receiver.id,
        )
      : undefined;
  const found = problem ? settlementFieldOf(problem) : null;

  const errorOf = (field: SettlementField): string | undefined => {
    if (unbuilt === field)
      return field === "payer"
        ? t("payerRequired")
        : field === "receiver"
          ? errors("InvalidSettlementParties")
          : form("amountUnreadable", { example: formatNumber("85000", formats) });
    return problem && found === field ? messageOf(problem).message : undefined;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    const zone = timeZone ?? browserTimeZone();
    const now = nowIn(new Date(), zone);
    const built = request({
      date: now.date,
      occurredAt: occurredAtOf(now.date, now.wall, zone),
      timeZone: zone,
    });
    if (!built.ok) {
      setUnbuilt(built.field);
      return;
    }
    setUnbuilt(null);
    setPending(true);
    try {
      const { error, response } = await api.POST("/api/v1/spaces/{spaceId}/settlements", {
        params: { path: { spaceId: space.id }, header: { "idempotency-key": key } },
        // Ruling P118: the sheet builds a plain object; the API is the validator of its shape.
        body: built.body as never,
      });
      if (response.ok) {
        renew();
        setPending(false);
        toast.show({ message: toasts("settled") });
        onOpenChange(false);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const memberChoices = members.map((member) => ({
    value: member.id,
    label: wrapped(memberLabel(member, meUserId, names)),
  }));
  const accountsOf = (field: "sourceAccountId" | "destinationAccountId", label: string) => (
    <div className="flex flex-col gap-2">
      <FieldLabel>{label}</FieldLabel>
      <ChoiceGroup
        label={label}
        layout="chips"
        value={draft[field] ?? ""}
        onValueChange={(value) => setDraft({ ...draft, [field]: value === "" ? null : value })}
        options={[
          { value: "", label: wrapped(t("none")) },
          ...myAccounts.map((account) => ({ value: account.id, label: wrapped(account.name) })),
        ]}
      />
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={space.name}
      footer={
        <Button type="submit" form="settle-up-form" size="lg" disabled={pending}>
          {t("save")}
        </Button>
      }
    >
      <form
        id="settle-up-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <FieldLabel>{t("payer")}</FieldLabel>
          <ChoiceGroup
            label={t("payer")}
            layout="chips"
            value={draft.payerMemberId ?? ""}
            onValueChange={(value) => setDraft({ ...draft, payerMemberId: value })}
            options={memberChoices}
            describedBy={errorOf("payer") ? "settle-payer-error" : undefined}
          />
          <FieldError id="settle-payer-error" message={errorOf("payer")} />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel>{t("receiver")}</FieldLabel>
          <ChoiceGroup
            label={t("receiver")}
            layout="chips"
            value={draft.receivingMemberId ?? ""}
            onValueChange={(value) => setDraft({ ...draft, receivingMemberId: value })}
            options={memberChoices}
            describedBy={errorOf("receiver") ? "settle-receiver-error" : undefined}
          />
          <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <NumberField
            id="settle-amount"
            label={t("amount")}
            kind="money"
            numberFormat={formats.numberFormat}
            decimals={currency.exponent}
            symbol={currency.symbol}
            value={draft.amount}
            error={errorOf("amount")}
            onChange={(amount) => setDraft({ ...draft, amount })}
            large
          />
          {payer && receiver && payer.id !== receiver.id ? (
            <p className="text-[13px] text-muted tabular-nums">
              {debt
                ? t("debt", {
                    payer: payer.displayName,
                    receiver: receiver.displayName,
                    amount: formatMoney(debt.amount, formats),
                  })
                : t("noDebt", { payer: payer.displayName, receiver: receiver.displayName })}
            </p>
          ) : null}
        </div>
        {payer?.kind === "GUEST" ? (
          <p className="flex gap-2.5 rounded-2xl bg-track p-3 text-sm text-ink">
            <Icon name="alert" size={20} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {t("guestNote", { name: payer.displayName })}
            </span>
          </p>
        ) : null}
        {payer?.id === meMemberId && myAccounts.length > 0 ? accountsOf("sourceAccountId", t("from")) : null}
        {receiver?.id === meMemberId && myAccounts.length > 0
          ? accountsOf("destinationAccountId", t("to"))
          : null}
        {problem && found === "form" ? <ProblemNotice problem={problem} /> : null}
      </form>
    </Sheet>
  );
}

function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <p aria-hidden="true" className="text-sm font-semibold text-ink">
      {children}
    </p>
  );
}

function FieldError({ id, message }: { readonly id: string; readonly message: string | undefined }) {
  return message ? (
    <p id={id} className="flex items-center gap-1.5 text-sm text-danger">
      <Icon name="alert" size={16} />
      {message}
    </p>
  ) : null;
}
