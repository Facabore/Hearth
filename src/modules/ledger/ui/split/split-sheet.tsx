"use client";

import { useTranslations } from "next-intl";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, ChoiceGroup, Icon, Sheet, cn, numberInputProps } from "@/shared/ui";
import type { AccountDto, MemberDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { exampleOf, type NumberRule } from "@/shared/ui/format/number-input";
import { SPLIT_METHODS, type SplitMethod } from "./split-math";
import { isUntouched, splitFailureMessage, type SplitFailure } from "./split-failure";
import { splitCheckOf, type SplitDraft } from "./split-request";
import type { DefaultSplitState } from "./use-default-split";

export interface SplitSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The expense in one line ("Mercado · $ 300.000 · Household"), shown under the sheet's title. */
  readonly title: string;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  /** The accounts the recorder may pay from (the ones they own). */
  readonly myAccounts: readonly AccountDto[];
  /** The space's active shared funds, which can pay with no payer member. */
  readonly funds: readonly AccountDto[];
  readonly draft: SplitDraft;
  readonly onChange: (draft: SplitDraft) => void;
  /** Minor units, or null while the expense has no amount. */
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  readonly defaultSplit: DefaultSplitState;
}

const payerValue = (payer: SplitDraft["payer"]) =>
  payer.kind === "ME"
    ? `me:${payer.memberId}`
    : payer.kind === "GUEST"
      ? `guest:${payer.memberId}`
      : `fund:${payer.accountId}`;

/** A choice that may be a long stored name: it wraps inside its pill instead of widening the sheet. */
const wrapped = (text: string) => <span className="block max-w-full break-words py-1.5">{text}</span>;

/** HU-E9-06, the Split artboard: who paid, how it is split and for whom, with the preview of each share (P166, P167). */
export function SplitSheet(props: SplitSheetProps) {
  const { open, onOpenChange, members, meUserId, myAccounts, funds, draft, onChange } = props;
  const { amount, currency, formats, defaultSplit } = props;
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
  const recorder = members.find((m) => m.userId !== null && m.userId === meUserId);
  const guests = members.filter((m) => m.kind === "GUEST");
  const payer = draft.payer;
  const guestPaying = payer.kind === "GUEST" ? members.find((m) => m.id === payer.memberId) : undefined;
  const fundPaying = payer.kind === "FUND" ? funds.find((f) => f.id === payer.accountId) : undefined;

  const pickPayer = (value: string) => {
    const [kind, id = ""] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    if (kind === "guest") onChange({ ...draft, payer: { kind: "GUEST", memberId: id } });
    else if (kind === "fund") onChange({ ...draft, payer: { kind: "FUND", accountId: id } });
    else
      onChange({
        ...draft,
        payer: {
          kind: "ME",
          memberId: id,
          accountId: payer.kind === "ME" ? payer.accountId : (myAccounts[0]?.id ?? null),
        },
      });
  };
  // A method, a participant or a value is the person's own work: the default split never undoes it (P167).
  const pickMethod = (method: SplitMethod) => {
    const planIds = (defaultSplit.status === "ready" ? (defaultSplit.shares ?? []) : [])
      .filter((s) => BigInt(s.amount) > 0n)
      .map((s) => s.memberId);
    onChange({
      ...draft,
      method,
      chosen: true,
      selected:
        method === "BY_ALLOCATION"
          ? members.map((m) => m.id).filter((id) => planIds.includes(id))
          : draft.selected,
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
  const setValue = (id: string, value: string) =>
    onChange({ ...draft, chosen: true, values: { ...draft.values, [id]: value } });

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

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
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
          <Button size="lg" disabled={check === null || !check.ok} onClick={() => onOpenChange(false)}>
            {t("done")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{t("payer")}</h3>
          <ChoiceGroup
            layout="chips"
            label={t("payer")}
            value={payerValue(payer)}
            onValueChange={pickPayer}
            options={[
              ...(recorder ? [{ value: `me:${recorder.id}`, label: wrapped(label(recorder)) }] : []),
              ...guests.map((guest) => ({ value: `guest:${guest.id}`, label: wrapped(label(guest)) })),
              ...funds.map((fund) => ({ value: `fund:${fund.id}`, label: wrapped(fund.name) })),
            ]}
          />
          {payer.kind === "ME" && myAccounts.length > 0 ? (
            <p aria-hidden="true" className="-mb-1 text-sm text-muted">
              {t("from")}
            </p>
          ) : null}
          {payer.kind === "ME" && myAccounts.length > 0 ? (
            <ChoiceGroup
              layout="chips"
              label={t("from")}
              value={payer.accountId ?? ""}
              onValueChange={(accountId) => onChange({ ...draft, payer: { ...payer, accountId } })}
              options={myAccounts.map((account) => ({ value: account.id, label: wrapped(account.name) }))}
            />
          ) : null}
          {guestPaying ? (
            <p className="text-sm text-muted">{t("guestPays", { name: guestPaying.displayName })}</p>
          ) : null}
          {fundPaying ? (
            <p className="text-sm text-muted">{t("fundPays", { fund: fundPaying.name })}</p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{t("method")}</h3>
          <ChoiceGroup
            layout="chips"
            label={t("method")}
            value={draft.method}
            onValueChange={pickMethod}
            options={methods.map((method) => ({ value: method, label: t(`methods.${method}`) }))}
          />
          <p className="text-sm text-muted">{t(`note.${draft.method}`)}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">{t("forWhom")}</h3>
          {!planned && draft.method !== "EQUAL" ? (
            <p id="split-format" className="text-sm text-muted">
              {common("numberExample", { example: example ?? "" })}
            </p>
          ) : null}
          <ul aria-label={t("forWhom")} className="overflow-hidden rounded-2xl border border-line">
            {members.map((member) => {
              const name = label(member);
              const isSelected = selected.includes(member.id);
              const share = sharesByMember.find((s) => s.memberId === member.id);
              const typed = !planned && draft.method !== "EQUAL" && isSelected;
              return (
                <li
                  key={member.id}
                  aria-labelledby={`split-name-${member.id}`}
                  className="flex min-h-[60px] flex-wrap items-center gap-x-2 border-b border-line py-1 pr-3.5 pl-1.5 last:border-b-0"
                >
                  <label className="flex min-h-11 min-w-32 flex-1 items-center gap-2.5 pl-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={planned}
                      onChange={() => toggle(member.id)}
                      className="size-[22px] shrink-0 accent-accent"
                    />
                    <span
                      id={`split-name-${member.id}`}
                      className="min-w-0 break-words text-base font-medium text-ink"
                    >
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
        </section>
      </div>
    </Sheet>
  );
}
