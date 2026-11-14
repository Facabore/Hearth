"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlsFor, LazyAddGuestsSheet, memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, Icon, Sheet, cn, numberInputProps } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { parseDecimal } from "@/shared/ui/format/amount-input";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { exampleOf, type NumberRule } from "@/shared/ui/format/number-input";
import { preferredAccountId, readLastAccount } from "../record/last-account";
import type { SharedExpenseContext } from "./shared-context";
import { equalPercents, remainingPercent, SPLIT_METHODS, type SplitMethod } from "./split-math";
import { isUntouched, splitFailureMessage, type SplitFailure } from "./split-failure";
import { splitCheckOf, type SplitDraft } from "./split-request";
import type { DefaultSplitState } from "./use-default-split";

/** Who may pay a shared expense and from where: what the split sheet and the payer sheet both draw. */
interface PayerChoiceProps {
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  /** The accounts the recorder may pay from (the ones they own). */
  readonly myAccounts: readonly AccountDto[];
  /** The space's active shared funds, which can pay with no payer member. */
  readonly funds: readonly AccountDto[];
  readonly draft: SplitDraft;
  readonly onChange: (draft: SplitDraft) => void;
  /** D26, P328: Registrar also offers "Pagaste por <fund>": the recorder pays from their account for the fund. */
  readonly forFund?: boolean;
}

export interface SplitSheetProps extends PayerChoiceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The expense in one line ("Mercado · $ 300.000 · Household"), shown under the sheet's title. */
  readonly title: string;
  /** Minor units, or null while the expense has no amount. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  readonly defaultSplit: DefaultSplitState;
  /** Ruling P309 (S6): when given, the sheet offers "Agregar a alguien", which opens the add-guests sheet. */
  readonly onAddGuests?: () => void;
  /**
   * Ruling P324 (S6): false where who paid has a sheet of its own (Registrar's "Quién pagó" row): the sheet then holds
   * only how it is split and for whom. A recurrence still asks who pays here (board E9-09 02).
   */
  readonly withPayer?: boolean;
}

const payerValue = (payer: SplitDraft["payer"]) =>
  payer.kind === "ME"
    ? `me:${payer.memberId}`
    : payer.kind === "GUEST"
      ? `guest:${payer.memberId}`
      : payer.kind === "FOR_FUND"
        ? `forfund:${payer.fundAccountId}`
        : `fund:${payer.accountId}`;

/** A choice that may be a long stored name: it wraps inside its pill instead of widening the sheet. */
const wrapped = (text: string) => <span className="block max-w-full break-words py-1.5">{text}</span>;

/**
 * Who paid: the recorder, a guest or a fund, then the account the recorder paid from. A guest paid outside the app and a
 * fund leaves nobody owing, and each says so. Choosing someone else is never the person's split work (P167).
 */
function PayerChoice({
  members,
  meUserId,
  myAccounts,
  funds,
  draft,
  onChange,
  forFund = false,
  heading,
}: PayerChoiceProps & { readonly heading: boolean }) {
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const label = (member: MemberDto) => memberLabel(member, meUserId, names);
  const recorder = members.find((m) => m.userId !== null && m.userId === meUserId);
  const guests = members.filter((m) => m.kind === "GUEST");
  const payer = draft.payer;
  const guestPaying = payer.kind === "GUEST" ? members.find((m) => m.id === payer.memberId) : undefined;
  const fundPaying = payer.kind === "FUND" ? funds.find((f) => f.id === payer.accountId) : undefined;
  const paidFor = payer.kind === "FOR_FUND" ? funds.find((f) => f.id === payer.fundAccountId) : undefined;
  // The recorder's own account stays chosen when they move between paying themselves and paying for the fund.
  const ownAccount =
    payer.kind === "ME" || payer.kind === "FOR_FUND"
      ? payer.accountId
      : preferredAccountId(myAccounts, readLastAccount());
  const ownPayer = payer.kind === "ME" || payer.kind === "FOR_FUND" ? payer : null;

  const pickPayer = (value: string) => {
    const [kind, id = ""] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    // P328: once the person picks who paid, the line's payers no longer propose it.
    const chosen = { ...draft, payerChosen: true };
    if (kind === "guest") onChange({ ...chosen, payer: { kind: "GUEST", memberId: id } });
    else if (kind === "fund") onChange({ ...chosen, payer: { kind: "FUND", accountId: id } });
    else if (kind === "forfund" && recorder)
      onChange({
        ...chosen,
        payer: { kind: "FOR_FUND", memberId: recorder.id, accountId: ownAccount, fundAccountId: id },
      });
    else onChange({ ...chosen, payer: { kind: "ME", memberId: id, accountId: ownAccount } });
  };

  return (
    <section className="flex flex-col gap-2">
      {heading ? <h3 className="text-sm font-semibold text-ink">{t("payer")}</h3> : null}
      <ChoiceGroup
        layout="chips"
        label={t("payer")}
        value={payerValue(payer)}
        onValueChange={pickPayer}
        options={[
          ...(recorder ? [{ value: `me:${recorder.id}`, label: wrapped(label(recorder)) }] : []),
          ...guests.map((guest) => ({ value: `guest:${guest.id}`, label: wrapped(label(guest)) })),
          ...funds.map((fund) => ({ value: `fund:${fund.id}`, label: wrapped(fund.name) })),
          ...(forFund && recorder
            ? funds.map((fund) => ({
                value: `forfund:${fund.id}`,
                label: wrapped(t("forFund", { fund: fund.name })),
              }))
            : []),
        ]}
      />
      {ownPayer && myAccounts.length > 0 ? (
        <p aria-hidden="true" className="-mb-1 text-sm text-muted">
          {t("from")}
        </p>
      ) : null}
      {ownPayer && myAccounts.length > 0 ? (
        <ChoiceGroup
          layout="chips"
          label={t("from")}
          value={ownPayer.accountId ?? ""}
          onValueChange={(accountId) =>
            onChange({ ...draft, payerChosen: true, payer: { ...ownPayer, accountId } })
          }
          options={myAccounts.map((account) => ({ value: account.id, label: wrapped(account.name) }))}
        />
      ) : null}
      {paidFor ? <p className="text-sm text-muted">{t("forFundPays", { fund: paidFor.name })}</p> : null}
      {guestPaying ? (
        <p className="text-sm text-muted">{t("guestPays", { name: guestPaying.displayName })}</p>
      ) : null}
      {fundPaying ? <p className="text-sm text-muted">{t("fundPays", { fund: fundPaying.name })}</p> : null}
    </section>
  );
}

/** Board "Cómo se divide" (P309, P324): the way to add a guest, who then pays or takes part. */
function AddSomeone({ onClick }: { readonly onClick: () => void }) {
  const t = useTranslations("ledger.split");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center gap-2 self-start text-base font-semibold text-accent"
    >
      <Icon name="userPlus" size={20} />
      {t("addGuests")}
    </button>
  );
}

/**
 * HU-E9-06, the Split artboard: how it is split and for whom, with the preview of each share (P166, P167), and who paid
 * unless that has a sheet of its own (`withPayer`, ruling P324).
 */
export function SplitSheet(props: SplitSheetProps) {
  const { open, onOpenChange, members, meUserId, draft, onChange } = props;
  const { amount, currency, formats, defaultSplit, onAddGuests, withPayer = true } = props;
  const t = useTranslations("ledger.split");
  const names = useTranslations("members");
  const common = useTranslations("common");
  const label = (member: MemberDto) => memberLabel(member, meUserId, names);

  const allocation = defaultSplit.status === "ready" ? defaultSplit.shares : null;
  const check = splitCheckOf(draft, {
    amount,
    currency,
    numberFormat: formats.numberFormat,
    memberIds: members.map((m) => m.id),
    allocation,
  });
  const methods = SPLIT_METHODS.filter((method) =>
    defaultSplit.status === "ready"
      ? defaultSplit.availableMethods.includes(method)
      : method !== "BY_ALLOCATION",
  );
  const planned = draft.method === "BY_ALLOCATION";
  // Issue #164: each row takes only what its method holds, and one line above them says how to type it.
  const numberFormat = formats.numberFormat;
  const rule: NumberRule =
    draft.method === "PERCENT"
      ? { kind: "decimal", numberFormat, decimals: 2 }
      : draft.method === "EXACT"
        ? { kind: "money", numberFormat, decimals: currencyOf(currency).exponent }
        : { kind: "integer", numberFormat };
  const example = exampleOf(
    rule,
    draft.method === "PERCENT" ? "33.5" : draft.method === "SHARES" ? "2" : undefined,
  );
  // The plan's participants are the API's, so the list follows them whatever the draft remembers.
  const selected = planned && allocation ? allocation.map((s) => s.memberId) : draft.selected;

  // The selected people in the members' order: the last one is who a percent split fills in (issue #177).
  const selectedInOrder = members.map((m) => m.id).filter((id) => draft.selected.includes(id));
  // A method, a participant or a value is the person's own work: the default split never undoes it (P167).
  const pickMethod = (method: SplitMethod) => {
    const planIds = (defaultSplit.status === "ready" ? (defaultSplit.shares ?? []) : [])
      .filter((s) => BigInt(s.amount) > 0n)
      .map((s) => s.memberId);
    // Issue #177: Porcentaje starts from equal shares that already add up, not from empty rows.
    const percents =
      method === "PERCENT" && draft.method !== "PERCENT" ? equalPercents(selectedInOrder.length) : null;
    onChange({
      ...draft,
      method,
      chosen: true,
      selected:
        method === "BY_ALLOCATION"
          ? members.map((m) => m.id).filter((id) => planIds.includes(id))
          : draft.selected,
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
    onChange({
      ...draft,
      chosen: true,
      selected: members
        .map((m) => m.id)
        .filter((memberId) =>
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
    onChange({ ...draft, chosen: true, values });
  };

  const reason = (failure: SplitFailure) =>
    splitFailureMessage(failure, t, {
      currency,
      formats,
      nameOf: (memberId) => {
        const member = members.find((m) => m.id === memberId);
        return member ? label(member) : "";
      },
    });
  const sharesByMember = check?.ok ? check.shares : [];

  // Nothing is reported on a row the person has not edited yet: a neutral hint, with Listo still disabled (S2).
  const quiet = check !== null && !check.ok && isUntouched(check, draft);
  const failing = check !== null && !check.ok && !quiet;

  const status =
    check === null ? null : check.ok ? (
      <>
        <Icon name="check" size={18} />
        {t("sum", { amount: formatMoney({ amount: amount ?? "0", currency }, formats) })}
      </>
    ) : quiet ? (
      t("incomplete")
    ) : (
      <>
        <Icon name="alert" size={18} />
        {reason(check)}
      </>
    );

  const methodChoice = (
    <ChoiceGroup
      layout="chips"
      label={t("method")}
      value={draft.method}
      onValueChange={pickMethod}
      options={methods.map((method) => ({ value: method, label: t(`methods.${method}`) }))}
    />
  );
  const people = (
    <>
      {!planned && draft.method !== "EQUAL" ? (
        <p id="split-format" className="text-sm text-muted">
          {common("numberExample", { example: example ?? "" })}
        </p>
      ) : null}
      <ul
        aria-label={t("forWhom")}
        className={withPayer ? "overflow-hidden rounded-2xl border border-line" : "flex flex-col"}
      >
        {members.map((member) => {
          const name = label(member);
          const isSelected = selected.includes(member.id);
          const share = sharesByMember.find((s) => s.memberId === member.id);
          const typed = !planned && draft.method !== "EQUAL" && isSelected;
          return (
            <li
              key={member.id}
              aria-labelledby={`split-name-${member.id}`}
              className={cn(
                "flex min-h-row flex-wrap items-center gap-x-2 border-b border-line py-1 last:border-b-0",
                withPayer ? "pr-3.5 pl-1.5" : "",
              )}
            >
              <label
                className={cn("flex min-h-11 min-w-32 flex-1 items-center gap-2.5", withPayer ? "pl-2" : "")}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={planned}
                  onChange={() => toggle(member.id)}
                  className="size-[22px] shrink-0 accent-accent"
                />
                <span id={`split-name-${member.id}`} className="min-w-0 break-words text-base text-ink">
                  {name}
                </span>
              </label>
              <div className="ml-auto flex items-center gap-2">
                {typed ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="text"
                      aria-label={t("valueOf", { name })}
                      aria-describedby="split-format"
                      {...numberInputProps(rule, {
                        value: draft.values[member.id] ?? "",
                        onChange: (next) => setValue(member.id, next),
                      })}
                      className={cn(
                        "h-11 rounded-[10px] border border-field bg-surface px-2 text-right text-base tabular-nums text-ink",
                        draft.method === "EXACT" ? "w-24" : "w-16",
                      )}
                    />
                    {draft.method === "PERCENT" ? (
                      <span aria-hidden="true" className="text-sm text-muted">
                        %
                      </span>
                    ) : draft.method === "SHARES" ? (
                      <span className="text-sm text-muted">{t("units")}</span>
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
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      // Ruling P324 (board "Cómo se divide"): without who paid, the sheet is named after the one decision it holds.
      title={withPayer ? t("title") : t("method")}
      description={props.title}
      footer={
        <div className="flex flex-col gap-3">
          <p
            role="status"
            className={cn(
              "flex min-h-5 items-start gap-2 text-sm",
              failing ? "text-danger" : quiet ? "text-muted" : "text-accent-strong",
            )}
          >
            {status}
          </p>
          {onAddGuests ? <AddSomeone onClick={onAddGuests} /> : null}
          <Button size="lg" disabled={check === null || !check.ok} onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </div>
      }
    >
      {withPayer ? (
        <div className="flex flex-col gap-3">
          {/* Issue #177: how it is split comes first, so its rows sit higher in the sheet. */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">{t("method")}</h3>
            {methodChoice}
            <p className="text-sm text-muted">{t(`note.${draft.method}`)}</p>
          </section>
          <PayerChoice {...props} heading />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">{t("forWhom")}</h3>
            {people}
          </section>
        </div>
      ) : (
        // Ruling P324 (S6, board "Cómo se divide"): only the method and the people, each with its share.
        <div className="flex flex-col gap-3">
          {methodChoice}
          <div className="flex flex-col gap-2">{people}</div>
        </div>
      )}
    </Sheet>
  );
}

export interface PayerSheetProps extends PayerChoiceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The expense in one line, shown under the sheet's title. */
  readonly title: string;
  /** Ruling P309: when given, the sheet offers "Agregar a alguien", for a guest who paid outside the app. */
  readonly onAddGuests?: () => void;
}

/**
 * Ruling P324 (S5, S6): Registrar's "Quién pagó" row opens this sheet, which holds what the split sheet held for who
 * paid: the recorder, a guest or a fund, and the account the recorder paid from. One decision, so Listo always closes it.
 */
export function PayerSheet({ open, onOpenChange, title, onAddGuests, ...choice }: PayerSheetProps) {
  const t = useTranslations("ledger.split");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("payerTitle")}
      description={title}
      footer={
        <div className="flex flex-col gap-3">
          {onAddGuests ? <AddSomeone onClick={onAddGuests} /> : null}
          <Button size="lg" onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </div>
      }
    >
      <PayerChoice {...choice} heading={false} />
    </Sheet>
  );
}

/** Which of a shared expense's two sheets is open: how it is split, or who paid. */
export type SharedSheet = "split" | "payer" | null;

export type SharedSplitSheetProps = Omit<
  SplitSheetProps,
  "open" | "onOpenChange" | "members" | "myAccounts" | "funds" | "onAddGuests" | "withPayer"
> & {
  readonly context: SharedExpenseContext;
  readonly api: Api;
  readonly sheet: SharedSheet;
  readonly onSheetChange: (sheet: SharedSheet) => void;
};

/**
 * Ruling P309 (S6): the sheets of a shared expense, how it is split and who paid (ruling P324). Whoever may add guests
 * to the space (`controlsFor`) gets "Agregar a alguien" in both: it opens the add-guests sheet over them, and the guests
 * it adds come back ticked (a choice of the person's own, so the plan's split no longer replaces it) and offered as who
 * paid, until the members read again holds them.
 */
export function SharedSplitSheet({ context, api, sheet, onSheetChange, ...props }: SharedSplitSheetProps) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<readonly MemberDto[]>([]);
  const members = [
    ...context.members,
    ...added.filter((guest) => !context.members.some((member) => member.id === guest.id)),
  ];
  const space = context.space;
  const mayAdd = space !== undefined && controlsFor(space.role, space.kind).addGuest;
  const selectAdded = (guests: readonly MemberDto[]) => {
    setAdded((before) => [...before, ...guests]);
    const ids = guests.map((guest) => guest.id);
    const { draft } = props;
    props.onChange({
      ...draft,
      method: draft.method === "BY_ALLOCATION" ? "EQUAL" : draft.method,
      selected: [...draft.selected.filter((id) => !ids.includes(id)), ...ids],
      chosen: true,
    });
  };
  const addGuests = mayAdd ? { onAddGuests: () => setAdding(true) } : {};
  const choice = {
    members,
    meUserId: props.meUserId,
    myAccounts: context.myAccounts,
    funds: context.funds,
    draft: props.draft,
    onChange: props.onChange,
  };
  return (
    <>
      <SplitSheet
        {...props}
        {...choice}
        open={sheet === "split"}
        onOpenChange={(open) => onSheetChange(open ? "split" : null)}
        withPayer={false}
        {...addGuests}
      />
      <PayerSheet
        {...choice}
        open={sheet === "payer"}
        onOpenChange={(open) => onSheetChange(open ? "payer" : null)}
        title={props.title}
        forFund={props.forFund}
        {...addGuests}
      />
      {adding && space ? (
        <LazyAddGuestsSheet open onOpenChange={setAdding} space={space} api={api} onAdded={selectAdded} />
      ) : null}
    </>
  );
}
