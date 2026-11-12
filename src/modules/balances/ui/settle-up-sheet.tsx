"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useIdempotencyKey } from "@/modules/ledger/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, Icon, NumberField, ProblemNotice, Sheet, SymbolIcon } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto, MoneyDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
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

/** A note under the amount: what saving it records, in words. */
const NOTE = "rounded-2xl bg-track p-3 text-sm text-ink tabular-nums [overflow-wrap:anywhere]";

export interface SettleUpSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name" | "currency" | "role">;
  /** The current members, guests included. */
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  /** The accounts the viewer owns: the only ones a payment may leave from or arrive in (D9). */
  readonly myAccounts: readonly AccountDto[];
  readonly suggestions: readonly SuggestionDto[];
  /** The draft the sheet starts from; the screen mounts the sheet only while it is open, so each opening is new. */
  readonly initial: SettlementDraft;
  /** A suggestion filled the draft in: the sheet says so, and offers as payer only who owes the receiver (board 02). */
  readonly suggested?: boolean;
  /** The account this browser last paid from (#219), as the screen read it when the sheet opened. */
  readonly lastAccountId: string | null;
  /** The account a payment starts on, on either side, from `myAccounts` and `lastAccountId` (#219, P312). */
  readonly preferredAccountId: string | null;
  readonly formats: Formats;
  /** The zone the payment is dated in; by default the browser's. */
  readonly timeZone?: string;
  readonly api?: Api;
}

/**
 * HU-E9-07, the SettleUp artboard (rulings P174 and P175): who pays whom and how much, prefilled from a suggestion or
 * empty. It records a payment now, in the browser's zone, with one `Idempotency-Key` per draft; a guest pays outside
 * the app, so no account is offered on their side.
 *
 * Ruling P272 (boards 02 and 03): from a suggestion, its receiver is a fixed row and the payer is chosen among who owes
 * them. Each account carries its wallet icon, and "(opcional)" is lighter than its label.
 *
 * Ruling P322 (boards B1-B4 and B8, amending P175 and P272): a viewer who is neither the suggestion's payer nor its
 * receiver may pay it themselves ("Lo pago yo") and say whether the debtor owes it to them or it is a gift; "Saldar
 * otro monto" chooses both who pays and who receives; and the suggestion's receiver, or an owner or admin when the
 * receiver is a guest, may forgive the debt instead, which moves no money.
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
  suggested = false,
  lastAccountId,
  preferredAccountId,
  formats,
  timeZone,
  api: injected,
}: SettleUpSheetProps) {
  const t = useTranslations("balances.settle");
  const tForgive = useTranslations("balances.forgive");
  const form = useTranslations("ledger.form");
  const errors = useTranslations("errors");
  const names = useTranslations("members");
  const toasts = useTranslations("balances.toast");
  const toast = useToast();
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  // Issue #219: a payment of the viewer's leaves from the account they last paid from (the record form's, #208), else
  // their first that is not a savings account. Ruling P312 (#282): a payment the viewer receives lands in that same
  // account by default, so it never reaches no account unnoticed; Ninguna stays a choice on both sides. Every active
  // account stays offered, a new one at zero too, with the one last paid from first and the rest in order.
  const accounts = useMemo(() => {
    const last = myAccounts.find((account) => account.id === lastAccountId);
    return last ? [last, ...myAccounts.filter((account) => account !== last)] : myAccounts;
  }, [myAccounts, lastAccountId]);
  const [draft, setDraft] = useState<SettlementDraft>(() => ({
    ...initial,
    sourceAccountId: initial.sourceAccountId ?? preferredAccountId,
    destinationAccountId: initial.destinationAccountId ?? preferredAccountId,
  }));
  const [unbuilt, setUnbuilt] = useState<SettlementField | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const currency = currencyOf(space.currency);
  const meMemberId = members.find((member) => member.userId === meUserId)?.id ?? "";
  const memberOf = (id: string | null | undefined) => members.find((member) => member.id === id);
  const payer = memberOf(draft.payerMemberId);
  const receiver = memberOf(draft.receivingMemberId);
  // P322: whose debt the viewer pays ("Lo pago yo"), and whether the sheet now forgives instead (board B8).
  const payingFor = memberOf(draft.onBehalfOfMemberId);
  const forgiving = draft.reason === "FORGIVENESS";
  const request = (when: { date: string; occurredAt: string; timeZone: string }) =>
    settlementRequestOf(draft, {
      currency: space.currency,
      numberFormat: formats.numberFormat,
      meMemberId,
      when,
    });
  const preview = request(NO_TIME);
  const { key, renew } = useIdempotencyKey(preview.ok ? JSON.stringify(preview.body) : "");
  const amount = preview.ok ? (preview.body.amount as MoneyDto) : null;
  const money = amount ? formatMoney(amount, formats) : "";

  const debtOf = (from: MemberDto | undefined, to: MemberDto | undefined) =>
    from && to && from.id !== to.id
      ? suggestions.find(
          (suggestion) => suggestion.payerMemberId === from.id && suggestion.receivingMemberId === to.id,
        )
      : undefined;
  const debt = debtOf(payer, receiver);
  /** Whether the amount is the whole of a debt: then the note may say that someone ends al día. */
  const settles = (owed: SuggestionDto | undefined) =>
    amount && owed && BigInt(amount.amount) === BigInt(owed.amount.amount) ? "yes" : "other";
  const found = problem ? settlementFieldOf(problem) : null;

  // P322: the suggestion the sheet opened from, and whether the viewer is a third party to it ("Lo pago yo").
  const opened = suggested
    ? suggestions.find(
        (suggestion) =>
          suggestion.payerMemberId === initial.payerMemberId &&
          suggestion.receivingMemberId === initial.receivingMemberId,
      )
    : undefined;
  /** The suggestion's debtor when the viewer is neither its payer nor its receiver: then "Lo pago yo" is offered. */
  const forOthers =
    opened &&
    meMemberId !== "" &&
    opened.payerMemberId !== meMemberId &&
    opened.receivingMemberId !== meMemberId
      ? memberOf(opened.payerMemberId)
      : undefined;
  // Board B8: forgiving belongs to who collects, or to whoever manages the space when a guest collects.
  const debtor = payingFor ?? payer;
  const manager = space.role === "OWNER" || space.role === "ADMIN";
  const forgivable =
    suggested &&
    !forgiving &&
    receiver !== undefined &&
    debtOf(debtor, receiver) !== undefined &&
    (receiver.id === meMemberId || (receiver.kind === "GUEST" && manager));

  const errorOf = (field: SettlementField): string | undefined => {
    if (unbuilt === field)
      return field === "payer"
        ? t("payerRequired")
        : field === "receiver"
          ? draft.receivingMemberId
            ? errors("InvalidSettlementParties")
            : t("receiverRequired")
          : form("amountUnreadable", { example: formatNumber("85000", formats) });
    return problem && found === field ? messageOf(problem).message : undefined;
  };
  // A problem whose field the sheet does not show at the moment is shown over the form.
  const onForm =
    problem !== null &&
    (found === "form" || (found === "gift" && (forgiving || !payingFor)) || (found === "payer" && forgiving));

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
        toast.show({ message: toasts(forgiving ? "forgiven" : "settled") });
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

  // Board B4 (P322): "Saldar otro monto" offers everyone, the viewer first as "Tú", as payer, and everyone but the
  // payer as receiver. From a suggestion (boards 02 and B1) the receiver stays fixed: the payers are who owe them, or,
  // for a third party, the debtor and "Lo pago yo".
  const chipOf = (member: MemberDto) => ({
    value: member.id,
    label: wrapped(!suggested && member.id === meMemberId ? t("me") : memberLabel(member, meUserId, names)),
  });
  const me = memberOf(meMemberId);
  const meFirst = me ? [me, ...members.filter((member) => member !== me)] : members;
  const owesReceiver = new Set(
    suggestions
      .filter((suggestion) => suggestion.receivingMemberId === draft.receivingMemberId)
      .map((suggestion) => suggestion.payerMemberId),
  );
  const payerChoices = !suggested
    ? meFirst.map(chipOf)
    : forOthers
      ? [chipOf(forOthers), { value: meMemberId, label: wrapped(t("iPay")) }]
      : members
          .filter(
            (member) =>
              member.id !== draft.receivingMemberId &&
              (owesReceiver.has(member.id) || member.id === draft.payerMemberId),
          )
          .map(chipOf);
  const receiverChoices = meFirst.filter((member) => member.id !== draft.payerMemberId).map(chipOf);
  const choosePayer = (value: string) => {
    if (forOthers) {
      const mine = value === meMemberId;
      setDraft({
        ...draft,
        payerMemberId: value,
        onBehalfOfMemberId: mine ? forOthers.id : null,
        gift: false,
      });
    } else if (!suggested)
      setDraft({
        ...draft,
        payerMemberId: value,
        receivingMemberId: draft.receivingMemberId === value ? null : draft.receivingMemberId,
      });
    else setDraft({ ...draft, payerMemberId: value });
  };
  const startForgiving = () => {
    if (!debtor || !receiver) return;
    setProblem(null);
    setUnbuilt(null);
    setDraft({
      payerMemberId: debtor.id,
      receivingMemberId: receiver.id,
      amount: draft.amount,
      sourceAccountId: null,
      destinationAccountId: null,
      reason: "FORGIVENESS",
    });
  };

  const accountsOf = (field: "sourceAccountId" | "destinationAccountId", label: string, visible: string) => (
    <div className="flex flex-col gap-2">
      <FieldLabel>
        {visible} <span className="font-normal text-muted">{t("optional")}</span>
      </FieldLabel>
      <ChoiceGroup
        label={label}
        layout="chips"
        value={draft[field] ?? ""}
        onValueChange={(value) => setDraft({ ...draft, [field]: value === "" ? null : value })}
        options={[
          { value: "", label: wrapped(t("none")) },
          ...accounts.map((account) => ({
            value: account.id,
            label: (
              <span className="flex max-w-full items-center gap-2 py-2.5 text-left [overflow-wrap:anywhere]">
                <SymbolIcon name="wallet" size={16} className="shrink-0" />
                <span className="min-w-0">{account.name}</span>
              </span>
            ),
          })),
        ]}
      />
    </div>
  );
  const fixedRow = (testId: string, term: string, member: MemberDto) => (
    <div className="flex flex-col gap-2">
      <p
        data-testid={testId}
        aria-describedby={errorOf("receiver") ? "settle-receiver-error" : undefined}
        className="flex min-h-12 items-center gap-3 rounded-2xl bg-track px-4 py-2.5 text-ink"
      >
        <span className="text-muted">{term}</span>{" "}
        <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
          {memberLabel(member, meUserId, names)}
        </span>
      </p>
      <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
    </div>
  );
  const amountField = (
    <NumberField
      id="settle-amount"
      label={t("amount")}
      kind="money"
      numberFormat={formats.numberFormat}
      decimals={currency.exponent}
      symbol={currency.symbol}
      value={draft.amount}
      // Board 02: a prefilled amount needs no example; an empty one shows how to write one (#164).
      example={draft.amount === "" ? undefined : false}
      error={errorOf("amount")}
      onChange={(typed) => setDraft({ ...draft, amount: typed })}
      large
    />
  );

  // P322: a payment between two others is only noted (boards B1 and B4); the viewer's money moves only when they pay.
  const thirdParty =
    !payingFor &&
    payer !== undefined &&
    receiver !== undefined &&
    payer.id !== receiver.id &&
    payer.id !== meMemberId &&
    receiver.id !== meMemberId;
  const plain = !forgiving && !payingFor;
  const footerLabel = forgiving
    ? money
      ? tForgive("save", { amount: money })
      : tForgive("saveBare")
    : payingFor
      ? draft.gift
        ? t("payAndGive")
        : t("payFor", { name: payingFor.displayName })
      : t("save");
  const owedForgiven = forgiving ? debt : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={forgiving && payer ? tForgive("title", { name: payer.displayName }) : t("title")}
      description={
        forgiving && payer && receiver && owedForgiven
          ? tForgive("subtitle", {
              space: space.name,
              debtor: payer.displayName,
              receiver: receiver.displayName,
              amount: formatMoney(owedForgiven.amount, formats),
            })
          : suggested
            ? t("prefilled", { space: space.name })
            : space.name
      }
      footer={
        <Button
          type="submit"
          form="settle-up-form"
          // A label that names a member may wrap at 320 px: the button grows with it, never shorter than 56 px.
          size={plain ? "lg" : "lgFlow"}
          className={plain ? undefined : "min-h-14 py-3 [overflow-wrap:anywhere]"}
          disabled={pending}
        >
          {footerLabel}
        </Button>
      }
    >
      <form
        id="settle-up-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3"
      >
        {forgiving ? (
          <>
            {receiver ? fixedRow("forgive-receiver", tForgive("receiver"), receiver) : null}
            {amountField}
            {payer && receiver && money ? (
              <p className={NOTE}>
                {tForgive(receiver.id === meMemberId ? "noteMine" : "noteGuest", {
                  debtor: payer.displayName,
                  receiver: receiver.displayName,
                  amount: money,
                  space: space.name,
                  settles: settles(debt),
                })}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <FieldLabel>{t("payer")}</FieldLabel>
              <ChoiceGroup
                label={t("payer")}
                layout="chips"
                value={draft.payerMemberId ?? ""}
                onValueChange={choosePayer}
                options={payerChoices}
                describedBy={errorOf("payer") ? "settle-payer-error" : undefined}
              />
              <FieldError id="settle-payer-error" message={errorOf("payer")} />
            </div>
            {suggested ? (
              receiver ? (
                fixedRow("settle-receiver", t("receiver"), receiver)
              ) : (
                <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
              )
            ) : (
              <div className="flex flex-col gap-2">
                <FieldLabel>{t("receiverChoice")}</FieldLabel>
                <ChoiceGroup
                  label={t("receiverChoice")}
                  layout="chips"
                  value={draft.receivingMemberId ?? ""}
                  onValueChange={(value) => setDraft({ ...draft, receivingMemberId: value })}
                  options={receiverChoices}
                  describedBy={errorOf("receiver") ? "settle-receiver-error" : undefined}
                />
                <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
              </div>
            )}
            {payingFor ? (
              <div className="flex flex-col gap-2">
                <FieldLabel>{t("payBack", { name: payingFor.displayName })}</FieldLabel>
                <ChoiceGroup
                  label={t("payBack", { name: payingFor.displayName })}
                  layout="chips"
                  value={draft.gift ? "gift" : "owes"}
                  onValueChange={(value) => setDraft({ ...draft, gift: value === "gift" })}
                  options={[
                    { value: "owes", label: wrapped(t("owesMe", { name: payingFor.displayName })) },
                    { value: "gift", label: wrapped(t("giveIt")) },
                  ]}
                  describedBy={errorOf("gift") ? "settle-gift-error" : undefined}
                />
                <FieldError id="settle-gift-error" message={errorOf("gift")} />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {amountField}
              {payer && receiver && payer.id !== receiver.id && !payingFor ? (
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
            {payingFor && receiver && money ? (
              <p className={NOTE}>
                {t(draft.gift ? "givingFor" : "payingFor", {
                  amount: money,
                  receiver: receiver.displayName,
                  debtor: payingFor.displayName,
                  settles: settles(debtOf(payingFor, receiver)),
                })}
              </p>
            ) : null}
            {thirdParty && payer && receiver && money ? (
              <p className={NOTE}>
                {suggested
                  ? t("recorded", { payer: payer.displayName, receiver: receiver.displayName, amount: money })
                  : t("recordedFree", {
                      payer: payer.displayName,
                      receiver: receiver.displayName,
                      amount: money,
                      settles: settles(debt),
                    })}
              </p>
            ) : null}
            {payer?.kind === "GUEST" && !thirdParty ? (
              <p className="flex gap-2.5 rounded-2xl bg-track p-3 text-sm text-ink">
                <Icon name="alert" size={20} />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {t("guestNote", { name: payer.displayName })}
                </span>
              </p>
            ) : null}
            {payer?.id === meMemberId && myAccounts.length > 0
              ? accountsOf("sourceAccountId", t("from"), t("fromName"))
              : null}
            {receiver?.id === meMemberId && myAccounts.length > 0
              ? accountsOf("destinationAccountId", t("to"), t("toName"))
              : null}
            {forgivable ? (
              <Button
                type="button"
                variant="ghost"
                size="compact"
                className="self-start"
                onClick={startForgiving}
              >
                {t("forgive")}
              </Button>
            ) : null}
          </>
        )}
        {problem && onForm ? <ProblemNotice problem={problem} /> : null}
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
