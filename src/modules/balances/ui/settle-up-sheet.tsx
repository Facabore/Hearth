"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useIdempotencyKey } from "@/modules/ledger/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, Icon, NumberField, ProblemNotice, Sheet, SymbolIcon } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import { currencyName } from "@/shared/ui/format/currency-names";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto, MoneyDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
import { AmountText } from "@/shared/ui/atoms/amount";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { decimalOf, formatMoney, formatNumber, NBSP, type Formats } from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn, occurredAtOf } from "@/shared/ui/time/when";
import {
  settlementFieldOf,
  settlementRequestOf,
  type SettlementDraft,
  type SettlementField,
} from "./settlement-request";
import { useSettleRate } from "./use-settle-rate";

/** A chip's label wraps inside the screen however long a stored name is (320 px). */
const wrapped = (text: string): ReactNode => (
  <span className="block max-w-full py-2.5 text-left [overflow-wrap:anywhere]">{text}</span>
);

/** The time fields never decide the draft's key: the clock moves every minute, the person's choices do not. */
const NO_TIME = { date: "", occurredAt: "", timeZone: "" } as const;

/** A note under the amount: what saving it records, in words. Its names wrap, its amount stays whole (P335). */
const NOTE = "rounded-2xl bg-track p-3 text-sm text-ink tabular-nums [overflow-wrap:anywhere]";
const Note = ({ text }: { readonly text: string }) => (
  <p className={NOTE}>
    <AmountText text={text} />
  </p>
);

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
  /**
   * The account a payment in a currency starts on, on either side, among `myAccounts` in that currency and from
   * `lastAccountId` (#219, P312, P342). The screen computes it, so this lazy chunk carries no copy of that code (#296).
   */
  readonly preferredAccountId: (currency: string) => string | null;
  readonly formats: Formats;
  /** The zone the payment is dated in; by default the browser's. */
  readonly timeZone?: string;
  /**
   * Ruling P342 (owner, "Pedir una cuenta en esa moneda"): where creating an account goes, with a way back to this
   * Saldar for the payer named; without it, a missing account offers only to settle in the debt's currency.
   */
  readonly newAccountHref?: (payerMemberId: string | null) => string;
  readonly api?: Api;
}

/** Ruling P342 (S5): the payment's side the viewer is on, "in" when they receive and "out" when they pay. */
type Side = "in" | "out";

/** A quiet action under the main one: a full 44 px target that wraps inside the screen (320 px). */
const QUIET = "min-h-11 w-full rounded-[14px] px-2 py-2.5 text-base text-muted [overflow-wrap:anywhere]";

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
 *
 * Ruling P324 (medium density, board "Saldar"): a suggestion with only one possible payer reads as a line, "Juan le paga
 * a Ana", over the amount; the account is a flat two-line row that opens its chooser; "Saldar otro monto" goes to the
 * amount, and "Perdonar en vez de cobrar" is the quiet action under the main one. The chip groups stay wherever there
 * is a real choice. The board's date row is not drawn: a payment is always dated now, so there is no picker to open.
 *
 * Ruling P342 (S5, board 3): a payment is in the debt's currency, chosen among the pair's debts when they owe in more
 * than one ("500.000 COP · 50 USD · 60 EUR"), and only accounts in that currency are offered. "Te pagó en …" (or
 * "Pagaste en …") settles it in another currency as an explicit exchange: the viewer types what moved in it, suggested
 * from the server's conversion at the day's rate, into one of their accounts in that currency. Without such an account
 * (owner, "Pedir una cuenta en esa moneda") the sheet offers to settle in the debt's currency or to create one.
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
  newAccountHref,
  api: injected,
}: SettleUpSheetProps) {
  const t = useTranslations("balances.settle");
  const tx = useTranslations("balances.settle.exchange");
  const locale = useLocale();
  const tBalances = useTranslations("balances");
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
  // P342: money moves in an account of its own currency, so each side is offered only the accounts in that currency.
  const accountsIn = (code: string) => accounts.filter((account) => account.balance.currency === code);
  const pick = preferredAccountId;
  const [draft, setDraft] = useState<SettlementDraft>(() => {
    const preferred = pick(initial.currency ?? space.currency);
    return {
      ...initial,
      sourceAccountId: initial.sourceAccountId ?? preferred,
      destinationAccountId: initial.destinationAccountId ?? preferred,
    };
  });
  const [unbuilt, setUnbuilt] = useState<SettlementField | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  // P324: the account chooser that is open under its row, if any.
  const [picking, setPicking] = useState<"sourceAccountId" | "destinationAccountId" | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);

  const code = draft.currency ?? space.currency;
  const currency = currencyOf(code);
  const nameOf = (one: string) => currencyName(one, locale);
  const meMemberId = members.find((member) => member.userId === meUserId)?.id ?? "";
  const memberOf = (id: string | null | undefined) => members.find((member) => member.id === id);
  const payer = memberOf(draft.payerMemberId);
  const receiver = memberOf(draft.receivingMemberId);
  // P322: whose debt the viewer pays ("Lo pago yo"), and whether the sheet now forgives instead (board B8).
  const payingFor = memberOf(draft.onBehalfOfMemberId);
  const forgiving = draft.reason === "FORGIVENESS";
  // P342 (board 3): the viewer's side of a plain payment between two people, where an exchange may be recorded.
  const side: Side | null =
    !forgiving && !payingFor && payer && receiver && payer.id !== receiver.id
      ? receiver.id === meMemberId
        ? "in"
        : payer.id === meMemberId
          ? "out"
          : null
      : null;
  const sideField = side === "in" ? "destinationAccountId" : "sourceAccountId";
  const legCode = side && draft.legCurrency && draft.legCurrency !== code ? draft.legCurrency : null;
  const legAccounts = legCode ? accountsIn(legCode) : [];
  const build = (from: SettlementDraft, when: { date: string; occurredAt: string; timeZone: string }) =>
    settlementRequestOf(from, {
      currency: space.currency,
      numberFormat: formats.numberFormat,
      meMemberId,
      when,
    });
  // What is settled, in the debt's currency, whatever moved in another.
  const settled = build({ ...draft, legCurrency: null }, NO_TIME);
  const amount = settled.ok ? (settled.body.amount as MoneyDto) : null;
  const money = amount ? formatMoney(amount, formats) : "";
  const zone = timeZone ?? browserTimeZone();
  const rate = useSettleRate(
    api,
    legCode && amount && legAccounts.length > 0
      ? { base: code, quote: legCode, on: nowIn(new Date(), zone).date, amount: amount.amount }
      : null,
  );
  // The server's conversion is the suggestion until the person types their own figure.
  const legShown =
    draft.legAmount ??
    (legCode && rate?.status === "found" && rate.converted !== null
      ? formatNumber(decimalOf(rate.converted, currencyOf(legCode).exponent), formats)
      : "");
  const effective: SettlementDraft = legCode
    ? { ...draft, legAmount: legShown }
    : { ...draft, legCurrency: null };
  const request = (when: { date: string; occurredAt: string; timeZone: string }) => build(effective, when);
  const preview = request(NO_TIME);
  const { key, renew } = useIdempotencyKey(preview.ok ? JSON.stringify(preview.body) : "");
  const leg = preview.ok
    ? (preview.body[side === "in" ? "destinationAmount" : "sourceAmount"] as MoneyDto | undefined)
    : undefined;
  const legMoney = leg ? formatMoney(leg, formats) : "";

  const debtOf = (from: MemberDto | undefined, to: MemberDto | undefined) =>
    from && to && from.id !== to.id
      ? suggestions.find(
          (suggestion) =>
            suggestion.payerMemberId === from.id &&
            suggestion.receivingMemberId === to.id &&
            suggestion.amount.currency === code,
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

  // P342: while exchanging, what was received or paid is the only field shown, so the amount's problems go under it.
  const legProblem = (field: SettlementField | "form" | null) => field === "leg" || field === "amount";
  const errorOf = (field: SettlementField): string | undefined => {
    if (unbuilt === field)
      return field === "payer"
        ? t("payerRequired")
        : field === "receiver"
          ? draft.receivingMemberId
            ? errors("InvalidSettlementParties")
            : t("receiverRequired")
          : form("amountUnreadable", { example: formatNumber("85000", formats) });
    if (!problem) return undefined;
    if (legCode && field === "leg") return legProblem(found) ? messageOf(problem).message : undefined;
    return found === field ? messageOf(problem).message : undefined;
  };
  // A problem whose field the sheet does not show at the moment is shown over the form.
  const onForm =
    problem !== null &&
    (legCode
      ? !legProblem(found)
      : found === "form" ||
        found === "leg" ||
        (found === "gift" && (forgiving || !payingFor)) ||
        (found === "payer" && forgiving));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
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
  // P324: a suggestion only its own payer can pay leaves nothing to choose, so the sheet says who pays whom in a line.
  const fixed =
    suggested &&
    !forOthers &&
    payer !== undefined &&
    receiver !== undefined &&
    payerChoices.length === 1 &&
    payerChoices[0]?.value === payer.id;
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
      currency: code,
      sourceAccountId: null,
      destinationAccountId: null,
      reason: "FORGIVENESS",
    });
  };

  // P342 (S5): the debts the payer owes the receiver, one per currency; a choice among them when there is more than one
  // currency to pay in, the one the sheet is on included.
  const pairDebts =
    payer && receiver
      ? suggestions.filter(
          (suggestion) =>
            suggestion.payerMemberId === payer.id && suggestion.receivingMemberId === receiver.id,
        )
      : [];
  const debtChoices = [
    ...pairDebts.map((owed) => ({
      value: owed.amount.currency,
      label: (
        <span className="block py-2.5 whitespace-nowrap tabular-nums">
          {formatMoney(owed.amount, formats)}
        </span>
      ),
    })),
    ...(pairDebts.some((owed) => owed.amount.currency === code)
      ? []
      : [{ value: code, label: <span className="block py-2.5">{code}</span> }]),
  ];
  const chooseDebt = (chosen: string) => {
    const owed = pairDebts.find((one) => one.amount.currency === chosen);
    setProblem(null);
    setUnbuilt(null);
    setDraft({
      ...draft,
      currency: chosen,
      amount: owed
        ? formatNumber(decimalOf(owed.amount.amount, currencyOf(chosen).exponent), formats)
        : draft.amount,
      legCurrency: null,
      legAmount: undefined,
      sourceAccountId: pick(chosen),
      destinationAccountId: pick(chosen),
    });
  };
  // P342 (board 3): the other currencies the money may have moved in, the space's and those of the viewer's accounts.
  const otherCurrencies =
    side && amount
      ? [...new Set([space.currency, ...myAccounts.map((account) => account.balance.currency)])].filter(
          (one) => one !== code,
        )
      : [];
  /** Settles in `chosen` as an exchange, or back in the debt's currency with null; the viewer's account follows it. */
  const exchangeIn = (chosen: string | null) => {
    setProblem(null);
    setUnbuilt(null);
    const account = pick(chosen ?? code);
    setDraft({
      ...draft,
      legCurrency: chosen,
      legAmount: undefined,
      ...(side === "in" ? { destinationAccountId: account } : { sourceAccountId: account }),
    });
  };

  // P324: the account is a flat two-line row, the one chosen over its term; tapping it opens the chooser under it.
  // P342: only the accounts in the currency the money moved in; an exchange needs one, so it offers no Ninguna.
  const accountsOf = (
    field: "sourceAccountId" | "destinationAccountId",
    label: string,
    visible: string,
    offered: readonly AccountDto[],
    none = true,
  ) => {
    const chosen = offered.find((account) => account.id === draft[field])?.name ?? t("none");
    const open = picking === field;
    const pickerId = `settle-${field}-picker`;
    return (
      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? pickerId : undefined}
          aria-label={t("accountRow", { term: visible, account: chosen })}
          onClick={() => setPicking(open ? null : field)}
          className="flex min-h-row-lg w-full items-center gap-2 border-b border-line py-1.5 text-left"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="[overflow-wrap:anywhere] text-ink">{chosen}</span>
            <span className="text-[13px] text-muted">{visible}</span>
          </span>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={20} className="shrink-0 text-muted" />
        </button>
        {open ? (
          <div id={pickerId} className="pt-3 pb-1">
            <ChoiceGroup
              label={label}
              layout="chips"
              value={draft[field] ?? ""}
              onValueChange={(value) => setDraft({ ...draft, [field]: value === "" ? null : value })}
              options={[
                ...(none ? [{ value: "", label: wrapped(t("none")) }] : []),
                ...offered.map((account) => ({
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
        ) : null}
      </div>
    );
  };
  // P324: a fixed party is a flat row too, its name over its term; the term comes first for a screen reader.
  const fixedRow = (testId: string, term: string, member: MemberDto) => (
    <div className="flex flex-col gap-2">
      <p
        data-testid={testId}
        aria-describedby={errorOf("receiver") ? "settle-receiver-error" : undefined}
        className="flex min-h-row-lg flex-col-reverse justify-center border-b border-line py-1.5"
      >
        <span className="text-[13px] text-muted">{term}</span>{" "}
        <span className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">
          {memberLabel(member, meUserId, names)}
        </span>
      </p>
      <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
    </div>
  );
  /** "Saldar otro monto" (P324): the amount is the field to change, so it gets the focus with its text selected. */
  const otherAmount = () => {
    amountInput.current?.focus();
    amountInput.current?.select();
  };
  const amountField = (
    <NumberField
      ref={amountInput}
      id="settle-amount"
      label={t("amount")}
      kind="money"
      numberFormat={formats.numberFormat}
      decimals={currency.exponent}
      currency={code}
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

  // P342 (board 3): what an exchange says. The hint gives the day's rate as the server sent it, never computed here.
  const exchangeHint = (base: string, quote: string) => {
    const one = formatMoney(
      { amount: (10n ** BigInt(currency.exponent)).toString(), currency: base },
      formats,
    );
    const rated =
      rate?.status === "found"
        ? `${tx("rate", { one, rate: `${formatNumber(rate.rate, formats)}${NBSP}${quote}` })} ${tx("only")}`
        : rate?.status === "missing"
          ? `${tx("noRate")} ${tx("only")}`
          : "";
    return `${tx("write", { side: side ?? "in" })} ${rated}`.trim();
  };
  const joined = (amounts: readonly string[]) =>
    amounts.length > 1
      ? `${amounts.slice(0, -1).join(", ")} ${tx("and")} ${amounts.at(-1)}`
      : (amounts[0] ?? "");
  /** What the payer still owes the receiver once this is saved, in every currency, never converted. */
  const remaining = pairDebts.flatMap((owed) => {
    if (owed.amount.currency !== code) return [formatMoney(owed.amount, formats)];
    const rest = amount ? BigInt(owed.amount.amount) - BigInt(amount.amount) : 0n;
    return rest > 0n ? [formatMoney({ amount: rest.toString(), currency: code }, formats)] : [];
  });
  const legAccount = legAccounts.find((account) => account.id === draft[sideField]);
  const exchangeSummary =
    legCode && side && payer && receiver ? (
      <p data-testid="exchange-summary" className={NOTE}>
        <strong className="font-semibold">
          <AmountText
            text={
              remaining.length > 0
                ? tx("remaining", {
                    me: side === "out" ? "yes" : "no",
                    debtor: payer.displayName,
                    amounts: joined(remaining),
                  })
                : tx("even", {
                    me: side === "out" ? "yes" : "no",
                    debtor: payer.displayName,
                    receiver: receiver.displayName,
                  })
            }
          />
        </strong>
        {legMoney && legAccount ? (
          <>
            {" "}
            <AmountText
              text={tx("moves", {
                settles: settles(debt),
                settled: money,
                side,
                account: legAccount.name,
                amount: legMoney,
              })}
            />
          </>
        ) : null}
      </p>
    ) : null;
  /** The way to settle in the debt's currency again, quiet under the main action. */
  const backToDebt = (
    <button type="button" onClick={() => exchangeIn(null)} className={QUIET}>
      {tx("to", { side: side ?? "in", currency: nameOf(code) })}
    </button>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={forgiving && payer ? tForgive("title", { name: payer.displayName }) : t("title")}
      description={
        legCode && payer
          ? tx("subtitle", {
              side: side ?? "in",
              amount: money,
              payer: payer.displayName,
              currency: nameOf(legCode),
            })
          : forgiving && payer && receiver && owedForgiven
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
        legCode && legAccounts.length === 0 ? (
          // Owner ("Pedir una cuenta en esa moneda"): without an account in that currency, the debt's or a new account.
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              size="lgFlow"
              className="min-h-14 py-3 [overflow-wrap:anywhere]"
              onClick={() => exchangeIn(null)}
            >
              {tx("settleIn", { currency: nameOf(code) })}
            </Button>
            {newAccountHref ? (
              <Link
                href={newAccountHref(draft.payerMemberId)}
                className={`${QUIET} flex items-center justify-center font-semibold text-accent`}
              >
                {tx("createAccount", { currency: nameOf(legCode) })}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Button
              type="submit"
              form="settle-up-form"
              // A label that names a member may wrap at 320 px: the button grows with it, never shorter than 56 px.
              size={plain && !legCode ? "lg" : "lgFlow"}
              className={plain && !legCode ? undefined : "min-h-14 py-3 [overflow-wrap:anywhere]"}
              disabled={pending}
            >
              {legCode
                ? legMoney
                  ? tx("save", { amount: money, leg: legMoney })
                  : tx("saveBare", { amount: money })
                : footerLabel}
            </Button>
            {legCode ? backToDebt : null}
            {/* P324: forgiving is the quiet way out under the main action. */}
            {forgivable && !legCode ? (
              <button type="button" onClick={startForgiving} className={QUIET}>
                {t("forgive")}
              </button>
            ) : null}
          </div>
        )
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
              <Note
                text={tForgive(receiver.id === meMemberId ? "noteMine" : "noteGuest", {
                  debtor: payer.displayName,
                  receiver: receiver.displayName,
                  amount: money,
                  space: space.name,
                  settles: settles(debt),
                })}
              />
            ) : null}
          </>
        ) : legCode && side ? (
          // P342 (board 3): what moved in the other currency, against what is settled in the debt's.
          legAccounts.length === 0 ? (
            <p className={NOTE}>{tx("noAccount", { currency: nameOf(legCode) })}</p>
          ) : (
            <>
              {/* The settled amount reads over the field, so the field keeps the screen's width at 320 px. */}
              <div className="flex flex-col gap-1">
                <p data-testid="exchange-equals" className="text-lg font-semibold text-ink tabular-nums">
                  <AmountText text={tx("equals", { amount: money })} />
                </p>
                <div>
                  <NumberField
                    id="settle-leg"
                    label={tx("label", { side })}
                    kind="money"
                    numberFormat={formats.numberFormat}
                    decimals={currencyOf(legCode).exponent}
                    currency={legCode}
                    value={legShown}
                    example={false}
                    hint={<AmountText text={exchangeHint(code, legCode)} />}
                    error={errorOf("leg")}
                    onChange={(typed) => setDraft({ ...draft, legAmount: typed })}
                    large
                  />
                </div>
              </div>
              {legAccounts.length > 1
                ? accountsOf(
                    sideField,
                    side === "in" ? t("toName") : t("fromName"),
                    side === "in" ? t("toName") : t("fromName"),
                    legAccounts,
                    false,
                  )
                : null}
              {exchangeSummary}
            </>
          )
        ) : (
          <>
            {fixed && payer && receiver ? (
              <div className="flex flex-col gap-1">
                <p data-testid="settle-parties" className="text-[15px] text-muted [overflow-wrap:anywhere]">
                  {t("parties", { payer: payer.displayName, receiver: receiver.displayName })}
                </p>
                <FieldError id="settle-payer-error" message={errorOf("payer")} />
                <FieldError id="settle-receiver-error" message={errorOf("receiver")} />
              </div>
            ) : (
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
            )}
            {fixed ? null : suggested ? (
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
            {!payingFor && new Set(debtChoices.map((choice) => choice.value)).size > 1 ? (
              <div className="flex flex-col gap-2">
                <FieldLabel>{t("debts")}</FieldLabel>
                <ChoiceGroup
                  label={t("debts")}
                  layout="chips"
                  value={code}
                  onValueChange={chooseDebt}
                  options={debtChoices}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {amountField}
              {/* P324: on a fixed suggestion the line and the amount already say it, so the sentence is not repeated. */}
              {payer && receiver && payer.id !== receiver.id && !payingFor && !fixed ? (
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
              <Note
                text={t(draft.gift ? "givingFor" : "payingFor", {
                  amount: money,
                  receiver: receiver.displayName,
                  debtor: payingFor.displayName,
                  settles: settles(debtOf(payingFor, receiver)),
                })}
              />
            ) : null}
            {thirdParty && payer && receiver && money ? (
              <Note
                text={
                  suggested
                    ? t("recorded", {
                        payer: payer.displayName,
                        receiver: receiver.displayName,
                        amount: money,
                      })
                    : t("recordedFree", {
                        payer: payer.displayName,
                        receiver: receiver.displayName,
                        amount: money,
                        settles: settles(debt),
                      })
                }
              />
            ) : null}
            {payer?.kind === "GUEST" && !thirdParty ? (
              <p className="flex gap-2.5 rounded-2xl bg-track p-3 text-sm text-ink">
                <Icon name="alert" size={20} />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {t("guestNote", { name: payer.displayName })}
                </span>
              </p>
            ) : null}
            {payer?.id === meMemberId && accountsIn(code).length > 0
              ? accountsOf("sourceAccountId", t("from"), t("fromName"), accountsIn(code))
              : null}
            {receiver?.id === meMemberId && accountsIn(code).length > 0
              ? accountsOf("destinationAccountId", t("to"), t("toName"), accountsIn(code))
              : null}
            {/* P342 (board 3): each other currency the money may have moved in, as a link of its own. */}
            {side
              ? otherCurrencies.map((other) => (
                  <Button
                    key={other}
                    type="button"
                    variant="ghost"
                    size="compact"
                    className="-ml-2 self-start"
                    onClick={() => exchangeIn(other)}
                  >
                    {tx("to", { side, currency: nameOf(other) })}
                  </Button>
                ))
              : null}
            {suggested ? (
              <Button
                type="button"
                variant="ghost"
                size="compact"
                className="-ml-2 self-start"
                onClick={otherAmount}
              >
                {tBalances("record")}
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
