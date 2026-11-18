"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ChoiceGroup, Icon, Sheet, TextField, cn, numberInputProps } from "@/shared/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { exampleOf, type NumberRule } from "@/shared/ui/format/number-input";
import { isUntouched, splitFailureMessage } from "./split-failure";
import { equalPercents, remainingPercent, type SplitMethod } from "./split-math";
import { splitCheckOf, type ShareDraft } from "./split-request";

/** Someone "Para quién fue" lists, with the name it shows ("Tú" for the recorder). */
export interface WhoPaidPerson {
  readonly id: string;
  readonly name: string;
  /** P340: what tells them apart in a search ("@juan", "Invitado · último movimiento 3/11/2026"). */
  readonly detail?: string | undefined;
  /** P340: other words a search finds them by (their apodo, their @). */
  readonly keys?: readonly string[] | undefined;
  /** P340: the date of their newest movement with the recorder (ISO), which orders who is recent. */
  readonly recent?: string | null | undefined;
}

/** P340: past this many other people, the sheet shows the recent ones and a search instead of everyone. */
export const CROWD = 5;
const RECENT_FOR_WHOM = 3;
const RECENT_PAYERS = 2;

/** Case and accents never stop a search, nor a leading @. */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const matches = (person: WhoPaidPerson, query: string) => {
  const needle = fold(query.trim().replace(/^@/, ""));
  return needle !== "" && [person.name, ...(person.keys ?? [])].some((key) => fold(key).includes(needle));
};
/** The newest movement first; people with none keep the order given, after the rest. */
const byRecent = (a: WhoPaidPerson, b: WhoPaidPerson) => (b.recent ?? "").localeCompare(a.recent ?? "");

export type PlanShares = readonly { readonly memberId: string; readonly amount: string }[];

export interface WhoPaidSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The expense in one line, under the title. */
  readonly description: string;
  /** "Pagó": the people (and funds) who may have paid, as chips. */
  readonly payers: readonly { readonly value: string; readonly label: string }[];
  readonly payer: string;
  readonly onPayer: (value: string) => void;
  /** The "+" chip of "Pagó": someone without Hearth paid, who becomes a guest. */
  readonly onAddPayer?: (() => void) | undefined;
  /** What paying this way means ("Juan lo pagó con su plata…"); none when the recorder paid. */
  readonly payerNote?: string | null | undefined;
  /** "Desde": the recorder's accounts, shown only when they paid; null hides it. */
  readonly accounts: readonly AccountDto[] | null;
  readonly accountId: string | null;
  readonly onAccount: (accountId: string) => void;
  /** Ruling P337: under "Desde", why it holds the account it does ("Bancolombia: con la que sueles pagar Gas."). */
  readonly fromHint?: string | null | undefined;
  /** "Para quién fue", in the order shown: the recorder first. */
  readonly people: readonly WhoPaidPerson[];
  readonly meId: string;
  /** Whoever paid among `people`, so each line says who owes whom; null for a fund, which leaves nobody owing. */
  readonly paidById: string | null;
  /** The people's ids in the order the split rounds in (the space's join order). */
  readonly memberIds: readonly string[];
  readonly draft: ShareDraft;
  readonly onDraft: (draft: ShareDraft) => void;
  readonly methods: readonly SplitMethod[];
  /** Minor units, or null while the expense has no amount. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  /** The plan's shares (HU-E6-08), when the API offers them. */
  readonly planShares: PlanShares | null;
  /** "+ Agregar a alguien" opens the add-guests sheet. */
  readonly onAddPerson?: (() => void) | undefined;
  /** "+ Agregar a alguien" asks for a name here instead: someone without Hearth, a guest once saved (P331). */
  readonly onAddByName?: ((name: string) => void) | undefined;
  /** The "+" of "Pagó" asks for a name here instead: someone without Hearth paid (P333, personal space). */
  readonly onAddPayerByName?: ((name: string) => void) | undefined;
  /** P333: why someone cannot be ticked ("Solo entre tú y Juan"), or null when they can. */
  readonly lockedReason?: ((id: string) => string | null) | undefined;
  /** A line under the list (P331: where each debt is kept). */
  readonly hint?: string | undefined;
  /** Under "Desde": a link to create an account that comes back to the form (N7), and what to say when there is none. */
  readonly newAccount?: { readonly href: string; readonly label: string; readonly empty: string } | undefined;
  /** P340: with more than `CROWD` other people, show the recent ones and a search instead of everyone. */
  readonly findable?: boolean | undefined;
}

/** A choice that may be a long stored name: it wraps inside its pill instead of widening the sheet. */
const wrapped = (text: string) => <span className="block max-w-full break-words py-1.5">{text}</span>;

/**
 * P333, board "¿Quién pagó y para quién?": who paid (and from which of the recorder's accounts), then whom it was for,
 * each with what they owe and a line saying to whom, and how it is split. One sheet, one Listo.
 */
export function WhoPaidSheet(props: WhoPaidSheetProps) {
  const { draft, onDraft, people, meId, paidById, memberIds, amount, currency, formats, planShares } = props;
  // Ruling P337: only the person's active money accounts, in the order given (the most used first).
  const accounts = props.accounts?.filter((account) => account.archivedAt === null) ?? null;
  const t = useTranslations("ledger.who");
  const ts = useTranslations("ledger.split");
  const common = useTranslations("common");
  const [naming, setNaming] = useState<"payer" | "person" | null>(null);
  const [name, setName] = useState("");
  // P340: what "Buscar o agregar a alguien" holds, and whether "Otra persona" opened its own search under Pagó.
  const [query, setQuery] = useState("");
  const [payerQuery, setPayerQuery] = useState<string | null>(null);

  const planned = draft.method === "BY_ALLOCATION";
  const check = splitCheckOf(draft, {
    amount,
    currency,
    numberFormat: formats.numberFormat,
    memberIds,
    allocation: planShares,
  });
  const shares = check?.ok ? check.shares : [];
  const selected = planned && planShares ? planShares.map((s) => s.memberId) : draft.selected;
  const selectedInOrder = memberIds.filter((id) => draft.selected.includes(id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  const payerName = paidById === null ? "" : nameOf(paidById);

  const numberFormat = formats.numberFormat;
  const rule: NumberRule =
    draft.method === "PERCENT"
      ? { kind: "decimal", numberFormat, decimals: 2 }
      : { kind: "money", numberFormat, decimals: currencyOf(currency).exponent };
  const example = exampleOf(rule, draft.method === "PERCENT" ? "33.5" : undefined);

  // A method, a person or a value is the person's own work: the plan's split never undoes it (P167).
  const pickMethod = (method: SplitMethod) => {
    const planIds = (planShares ?? []).filter((s) => BigInt(s.amount) > 0n).map((s) => s.memberId);
    // Issue #177: Porcentaje starts from equal shares that already add up, not from empty rows.
    const percents =
      method === "PERCENT" && draft.method !== "PERCENT" ? equalPercents(selectedInOrder.length) : null;
    onDraft({
      ...draft,
      method,
      chosen: true,
      selected: method === "BY_ALLOCATION" ? memberIds.filter((id) => planIds.includes(id)) : draft.selected,
      values: percents
        ? {
            ...draft.values,
            ...Object.fromEntries(
              selectedInOrder.map((id, index) => [id, formatNumber(percents[index]!, formats)]),
            ),
          }
        : draft.values,
    });
  };
  const toggle = (id: string) =>
    onDraft({
      ...draft,
      chosen: true,
      selected: memberIds.filter((memberId) =>
        memberId === id ? !draft.selected.includes(id) : draft.selected.includes(memberId),
      ),
    });
  const setValue = (id: string, value: string) => {
    const values = { ...draft.values, [id]: value };
    // Issue #177: in Porcentaje the last selected person takes what the others leave, while it is not negative.
    const last = selectedInOrder.at(-1);
    if (draft.method === "PERCENT" && last !== undefined && id !== last) {
      const rest = remainingPercent(
        selectedInOrder
          .filter((memberId) => memberId !== last)
          .map((memberId) => parseDecimal(values[memberId] ?? "", formats.numberFormat)),
      );
      if (rest !== null) values[last] = formatNumber(rest, formats);
    }
    onDraft({ ...draft, chosen: true, values });
  };

  /** P333: what each line says, from who paid: "Te debe", "Le debes a Juan", "Su parte", "No le toca nada"… */
  const lineOf = (id: string, ticked: boolean): string => {
    const me = id === meId;
    if (!ticked) return t(me ? "line.notYou" : "line.notThem");
    if (paidById === null || id === paidById) return t(me ? "line.yourPart" : "line.theirPart");
    if (paidById === meId) return t("line.owesYou");
    return me ? t("line.youOwe", { payer: payerName }) : t("line.owes", { payer: payerName });
  };

  const quiet = check !== null && !check.ok && isUntouched(check, draft);
  const failing = check !== null && !check.ok && !quiet;
  const status = failing
    ? splitFailureMessage(check, ts, { currency, formats, nameOf })
    : quiet
      ? ts("incomplete")
      : null;

  const addByName = () => {
    const trimmed = name.trim();
    const add = naming === "payer" ? props.onAddPayerByName : props.onAddByName;
    if (trimmed === "" || !add) return;
    add(trimmed);
    setName("");
    setNaming(null);
  };
  const nameField = (
    <div className="flex flex-col gap-2">
      <TextField
        id="who-new-guest"
        label={t("guestName")}
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button variant="secondary" className="self-start" disabled={name.trim() === ""} onClick={addByName}>
        {t("add")}
      </Button>
    </div>
  );
  const onAddPayer = props.onAddPayer ?? (props.onAddPayerByName ? () => setNaming("payer") : undefined);

  // P340: with many people, "Para quién fue" shows Tú, whoever is ticked and the most recent, then a search.
  const others = people.filter((p) => p.id !== meId);
  const crowded = props.findable === true && others.length > CROWD;
  const searching = crowded && query.trim().replace(/^@/, "") !== "";
  const ticked = others.filter((p) => selected.includes(p.id));
  const shown: readonly WhoPaidPerson[] = !crowded
    ? people
    : searching
      ? others.filter((p) => matches(p, query))
      : [
          ...people.filter((p) => p.id === meId),
          ...ticked,
          ...others
            .filter((p) => !selected.includes(p.id))
            .sort(byRecent)
            .slice(0, RECENT_FOR_WHOM),
        ];
  const kept = searching ? ticked.filter((p) => !shown.includes(p)).map((p) => p.name) : [];
  const keptLine =
    kept.length === 0
      ? null
      : kept.length === 1
        ? t("kept.one", { a: kept[0]! })
        : kept.length === 2
          ? t("kept.two", { a: kept[0]!, b: kept[1]! })
          : t("kept.many", { count: kept.length });
  // P340: Pagó offers Tú, whoever paid and the two most recent; "Otra persona" searches the rest.
  const payersCrowded = props.findable === true && props.payers.length - 1 > CROWD;
  const recentOf = (id: string) => people.find((p) => p.id === id) ?? { id, name: "" };
  const shownPayers = !payersCrowded
    ? props.payers
    : [
        ...props.payers.filter((o) => o.value === meId || o.value === props.payer),
        ...props.payers
          .filter((o) => o.value !== meId && o.value !== props.payer)
          .sort((a, b) => byRecent(recentOf(a.value), recentOf(b.value)))
          .slice(0, RECENT_PAYERS),
      ];
  const payerMatches =
    payerQuery === null
      ? []
      : props.payers
          .filter((o) => o.value !== meId)
          .map((o) => ({ ...recentOf(o.value), name: o.label }))
          .filter((p) => matches(p, payerQuery));
  const addGuestButton = (typed: string, add: (name: string) => void) => (
    <button
      type="button"
      onClick={() => add(typed.trim())}
      className="flex min-h-11 items-center gap-2 self-start text-base font-semibold text-accent"
    >
      <Icon name="plus" size={18} />
      {t("addNamed", { name: typed.trim() })}
    </button>
  );
  const searchField = (id: string, label: string, value: string, onChange: (next: string) => void) => (
    <label className="relative flex items-center">
      <span className="sr-only">{label}</span>
      <Icon name="search" size={20} className="pointer-events-none absolute left-3 text-muted" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        autoComplete="off"
        className="h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-10 text-base text-ink placeholder:text-muted"
      />
    </label>
  );

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("title")}
      description={props.description}
      footer={
        <div className="flex flex-col gap-3">
          {status ? (
            <p
              role="status"
              className={cn("flex items-start gap-2 text-sm", failing ? "text-danger" : "text-muted")}
            >
              {failing ? <Icon name="alert" size={18} /> : null}
              {status}
            </p>
          ) : null}
          <Button size="lg" disabled={check === null || !check.ok} onClick={() => props.onOpenChange(false)}>
            {ts("done")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{t("paid")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <ChoiceGroup
              layout="chips"
              label={t("paid")}
              value={props.payer}
              onValueChange={props.onPayer}
              options={shownPayers.map((option) => ({ value: option.value, label: wrapped(option.label) }))}
            />
            {payersCrowded ? (
              <button
                type="button"
                aria-expanded={payerQuery !== null}
                onClick={() => setPayerQuery(payerQuery === null ? "" : null)}
                className="flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink"
              >
                {t("otherPayer")}
              </button>
            ) : onAddPayer ? (
              <button
                type="button"
                aria-label={t("addPayer")}
                onClick={onAddPayer}
                className="flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink"
              >
                <Icon name="plus" size={18} />
              </button>
            ) : null}
          </div>
          {accounts && accounts.length > 0 ? (
            <>
              <h3 aria-hidden="true" className="text-sm font-semibold text-ink">
                {t("from")}
              </h3>
              {props.fromHint ? <p className="-mt-1 text-sm text-muted">{props.fromHint}</p> : null}
              <ChoiceGroup
                layout="chips"
                label={t("from")}
                value={props.accountId ?? ""}
                onValueChange={props.onAccount}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: wrapped(account.name),
                }))}
              />
            </>
          ) : null}
          {accounts && props.newAccount ? (
            <>
              {accounts.length === 0 ? (
                <p className="rounded-2xl bg-track p-3 text-sm text-ink">{props.newAccount.empty}</p>
              ) : null}
              <Link
                href={props.newAccount.href}
                onClick={() => props.onOpenChange(false)}
                className="flex min-h-11 items-center gap-2 self-start text-base font-semibold text-accent"
              >
                <Icon name="plus" size={18} />
                {props.newAccount.label}
              </Link>
            </>
          ) : null}
          {payerQuery !== null ? (
            <div className="flex flex-col gap-1">
              {searchField("who-find-payer", t("findPayer"), payerQuery, setPayerQuery)}
              <ul aria-label={t("findPayer")} className="flex flex-col">
                {payerMatches.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      onClick={() => {
                        props.onPayer(match.id);
                        setPayerQuery(null);
                      }}
                      className="flex min-h-row w-full flex-col justify-center py-1 text-left"
                    >
                      <span className="break-words text-base text-ink">{match.name}</span>
                      {match.detail ? <span className="text-sm text-muted">{match.detail}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              {payerQuery.trim() !== "" && props.onAddPayerByName
                ? addGuestButton(payerQuery, (typed) => {
                    props.onAddPayerByName?.(typed);
                    setPayerQuery(null);
                  })
                : null}
            </div>
          ) : null}
          {naming === "payer" ? nameField : null}
          {props.payerNote ? <p className="text-sm text-muted">{props.payerNote}</p> : null}
        </section>
        <section className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="text-sm font-semibold text-ink">{t("forWhom")}</h3>
          {!planned && draft.method !== "EQUAL" ? (
            <p id="who-format" className="text-sm text-muted">
              {common("numberExample", { example: example ?? "" })}
            </p>
          ) : null}
          <ul aria-label={t("forWhom")} className="flex flex-col">
            {shown.map((person) => {
              const ticked = selected.includes(person.id);
              const share = shares.find((s) => s.memberId === person.id);
              const typed = !planned && draft.method !== "EQUAL" && ticked;
              const locked = props.lockedReason?.(person.id) ?? null;
              return (
                <li
                  key={person.id}
                  aria-labelledby={`who-name-${person.id}`}
                  className="flex min-h-row flex-wrap items-center gap-x-2 py-1"
                >
                  <label className="flex min-h-11 min-w-32 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={ticked}
                      disabled={planned || locked !== null}
                      onChange={() => toggle(person.id)}
                      aria-describedby={`who-line-${person.id}`}
                      className="size-[22px] shrink-0 accent-accent"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span id={`who-name-${person.id}`} className="break-words text-base text-ink">
                        {person.name}
                      </span>
                      <span id={`who-line-${person.id}`} className="text-sm text-muted">
                        {locked ??
                          (searching && !ticked && person.detail ? person.detail : lineOf(person.id, ticked))}
                      </span>
                    </span>
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    {typed ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="text"
                          aria-label={ts("valueOf", { name: person.name })}
                          aria-describedby="who-format"
                          {...numberInputProps(rule, {
                            value: draft.values[person.id] ?? "",
                            onChange: (next) => setValue(person.id, next),
                          })}
                          className={cn(
                            "h-11 rounded-[10px] border border-field bg-surface px-2 text-right text-base tabular-nums text-ink",
                            draft.method === "PERCENT" ? "w-16" : "w-24",
                          )}
                        />
                        {draft.method === "PERCENT" ? (
                          <span aria-hidden="true" className="text-sm text-muted">
                            %
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="min-w-14 text-right text-base font-semibold tabular-nums whitespace-nowrap text-ink">
                      {share ? formatMoney({ amount: share.amount, currency }, formats) : "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {crowded ? (
            <div className="flex flex-col gap-2">
              {searchField("who-find", t("find"), query, setQuery)}
              {searching ? (
                <>
                  {props.onAddByName
                    ? addGuestButton(query, (typed) => {
                        props.onAddByName?.(typed);
                        setQuery("");
                      })
                    : null}
                  {keptLine ? <p className="text-sm text-muted">{keptLine}</p> : null}
                </>
              ) : (
                <p className="text-sm text-muted">{t("findNote", { count: others.length })}</p>
              )}
            </div>
          ) : props.onAddByName && naming === "person" ? (
            nameField
          ) : props.onAddPerson || props.onAddByName ? (
            <button
              type="button"
              onClick={props.onAddPerson ?? (() => setNaming("person"))}
              className="flex min-h-11 items-center gap-2 self-start text-base font-semibold text-accent"
            >
              <Icon name="plus" size={18} />
              {t("addPerson")}
            </button>
          ) : null}
          <ChoiceGroup
            layout="chips"
            label={ts("method")}
            value={draft.method}
            onValueChange={pickMethod}
            options={props.methods.map((method) => ({ value: method, label: ts(`methods.${method}`) }))}
          />
          {props.hint ? <p className="text-sm text-muted">{props.hint}</p> : null}
        </section>
      </div>
    </Sheet>
  );
}
