"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlsFor, LazyAddGuestsSheet, memberLabel } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, MemberDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import type { Person } from "../direct/counterparts";
import type { PersonalForWhom } from "../direct/personal-split";
import { preferredAccountId, readLastAccount } from "../record/last-account";
import type { SharedExpenseContext } from "./shared-context";
import type { Payer, ShareDraft, SplitDraft } from "./split-request";
import type { DefaultSplitState } from "./use-default-split";
import { WhoPaidSheet } from "./who-paid-sheet";

export interface SharedWhoPaidSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly context: SharedExpenseContext;
  readonly api: Api;
  readonly meUserId: string;
  readonly draft: SplitDraft;
  readonly onChange: (draft: SplitDraft) => void;
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  readonly defaultSplit: DefaultSplitState;
  /** D26, P328: "Pagó" also offers "Pagaste por <fund>": the recorder pays from their account for the fund. */
  readonly forFund?: boolean;
}

/** The chip value of who paid. */
export const payerValue = (payer: Payer): string =>
  payer.kind === "FUND"
    ? `fund:${payer.accountId}`
    : payer.kind === "FOR_FUND"
      ? `forfund:${payer.fundAccountId}`
      : `${payer.kind === "ME" ? "me" : "other"}:${payer.memberId}`;

/**
 * P333: a shared or direct space's "¿Quién pagó y para quién?". "Pagó" offers the recorder, every other member (a
 * registered one pays with their own money, P168 amended, a guest outside the app), the funds and, for a new expense,
 * paying for a fund (D26); "+" adds a guest who paid. Whoever may add guests (`controlsFor`) gets both ways to add one
 * (P309): the guests added come back ticked, and the one added from "Pagó" is who paid.
 */
export function SharedWhoPaidSheet(props: SharedWhoPaidSheetProps) {
  const { context, api, meUserId, draft, onChange, defaultSplit, forFund = false } = props;
  const t = useTranslations("ledger.who");
  const ts = useTranslations("ledger.split");
  const names = useTranslations("members");
  const [adding, setAdding] = useState<"payer" | "person" | null>(null);
  const [added, setAdded] = useState<readonly MemberDto[]>([]);
  const members = [
    ...context.members,
    ...added.filter((guest) => !context.members.some((member) => member.id === guest.id)),
  ];
  const memberIds = members.map((member) => member.id);
  const me = members.find((m) => m.id === context.meMemberId);
  const others = members.filter((m) => m.id !== context.meMemberId);
  const nameOf = (member: MemberDto) =>
    member.id === context.meMemberId ? t("you") : memberLabel(member, meUserId, names);
  const space = context.space;
  const mayAdd = space !== undefined && controlsFor(space.role, space.kind).addGuest;
  const { payer } = draft;
  // The recorder's own account stays chosen when they move between paying themselves and paying for the fund.
  const ownAccount =
    payer.kind === "ME" || payer.kind === "FOR_FUND"
      ? payer.accountId
      : preferredAccountId(context.myAccounts, readLastAccount());

  const pickPayer = (value: string) => {
    const at = value.indexOf(":");
    const [kind, id] = [value.slice(0, at), value.slice(at + 1)];
    // P328: once the person picks who paid, the line's payers no longer propose it.
    const chosen = { ...draft, payerChosen: true };
    const member = members.find((m) => m.id === id);
    if (kind === "fund") onChange({ ...chosen, payer: { kind: "FUND", accountId: id } });
    else if (kind === "forfund")
      onChange({
        ...chosen,
        payer: { kind: "FOR_FUND", memberId: context.meMemberId, accountId: ownAccount, fundAccountId: id },
      });
    else if (kind === "other" && member)
      onChange({
        ...chosen,
        payer: member.userId === null ? { kind: "GUEST", memberId: id } : { kind: "MEMBER", memberId: id },
      });
    else onChange({ ...chosen, payer: { kind: "ME", memberId: context.meMemberId, accountId: ownAccount } });
  };

  const addedGuests = (guests: readonly MemberDto[]) => {
    setAdded((before) => [...before, ...guests]);
    const ids = guests.map((guest) => guest.id);
    const first = guests[0];
    onChange({
      ...draft,
      method: draft.method === "BY_ALLOCATION" ? "EQUAL" : draft.method,
      selected: [...draft.selected.filter((id) => !ids.includes(id)), ...ids],
      chosen: true,
      ...(adding === "payer" && first
        ? { payer: { kind: "GUEST" as const, memberId: first.id }, payerChosen: true }
        : {}),
    });
  };

  const paidBy = payer.kind === "FUND" || payer.kind === "FOR_FUND" ? null : payer.memberId;
  const paying = paidBy === null ? undefined : members.find((m) => m.id === paidBy);
  const fund =
    payer.kind === "FUND" || payer.kind === "FOR_FUND"
      ? context.funds.find((f) => f.id === (payer.kind === "FUND" ? payer.accountId : payer.fundAccountId))
      : undefined;
  const payerNote =
    payer.kind === "FUND" && fund
      ? ts("fundPays", { fund: fund.name })
      : payer.kind === "FOR_FUND" && fund
        ? ts("forFundPays", { fund: fund.name })
        : (payer.kind === "MEMBER" || payer.kind === "GUEST") && paying
          ? t("otherPaid", { name: paying.displayName })
          : null;
  // Board "¿Quién pagó y para quién?": Iguales, Montos, Porcentaje, and the plan's split where it applies.
  const methods = (["EQUAL", "EXACT", "PERCENT", "BY_ALLOCATION"] as const).filter((method) =>
    defaultSplit.status === "ready"
      ? defaultSplit.availableMethods.includes(method)
      : method !== "BY_ALLOCATION",
  );

  return (
    <>
      <WhoPaidSheet
        open={props.open}
        onOpenChange={props.onOpenChange}
        description={props.title}
        payers={[
          ...(me ? [{ value: `me:${me.id}`, label: t("you") }] : []),
          ...others.map((member) => ({ value: `other:${member.id}`, label: nameOf(member) })),
          ...context.funds.map((f) => ({ value: `fund:${f.id}`, label: f.name })),
          ...(forFund && me
            ? context.funds.map((f) => ({ value: `forfund:${f.id}`, label: ts("forFund", { fund: f.name }) }))
            : []),
        ]}
        payer={payerValue(payer)}
        onPayer={pickPayer}
        onAddPayer={mayAdd ? () => setAdding("payer") : undefined}
        payerNote={payerNote}
        accounts={payer.kind === "ME" || payer.kind === "FOR_FUND" ? context.myAccounts : null}
        accountId={payer.kind === "ME" || payer.kind === "FOR_FUND" ? payer.accountId : null}
        onAccount={(accountId) => {
          if (payer.kind === "ME" || payer.kind === "FOR_FUND")
            onChange({ ...draft, payerChosen: true, payer: { ...payer, accountId } });
        }}
        people={[...(me ? [me] : []), ...others].map((member) => ({ id: member.id, name: nameOf(member) }))}
        meId={context.meMemberId}
        paidById={paidBy}
        memberIds={memberIds}
        draft={draft}
        onDraft={(next) => onChange({ ...draft, ...next })}
        methods={methods}
        amount={props.amount}
        currency={props.currency}
        formats={props.formats}
        planShares={defaultSplit.status === "ready" ? defaultSplit.shares : null}
        onAddPerson={mayAdd ? () => setAdding("person") : undefined}
      />
      {adding && space ? (
        <LazyAddGuestsSheet
          open
          onOpenChange={(open) => setAdding(open ? adding : null)}
          space={space}
          api={api}
          onAdded={addedGuests}
        />
      ) : null}
    </>
  );
}

export interface PersonalWhoPaidSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** The recorder's accounts: "Desde". */
  readonly accounts: readonly AccountDto[];
  readonly accountId: string | null;
  readonly onAccount: (accountId: string) => void;
  /** The people the recorder shares a space with (P172). */
  readonly people: readonly Person[];
  readonly forWhom: PersonalForWhom;
  /** The recorder's id in "Para quién fue", and everyone's in the order the split rounds in (P331). */
  readonly meId: string;
  readonly memberIds: readonly string[];
  readonly onForWhom: (forWhom: PersonalForWhom) => void;
  readonly amount: string | null;
  readonly currency: string;
  readonly formats: Formats;
  /** N7: where "Nueva cuenta" goes, with a way back to this form. */
  readonly newAccountHref?: string | undefined;
}

/**
 * P331, P333: a personal expense's "¿Quién pagó y para quién?". The recorder paid, from one of their accounts; it was
 * for them, for the people they share a space with, or for someone without Hearth typed here (a guest once saved), in
 * equal parts, amounts or percentages. Each debt is recorded in the pair's direct space.
 */
export function PersonalWhoPaidSheet(props: PersonalWhoPaidSheetProps) {
  const { forWhom, onForWhom, people, meId } = props;
  const t = useTranslations("ledger.who");
  const names = useTranslations("members");
  const tAccounts = useTranslations("accounts");
  const guestName = (name: string) => `${name} ${names("guestSuffix")}`;
  const everyone = [
    ...people.map((p) => ({ id: p.memberId, name: p.isGuest ? guestName(p.name) : p.name, first: p.name })),
    ...forWhom.guests.map((g) => ({ id: g.id, name: guestName(g.name), first: g.name })),
  ];
  const paying = everyone.find((p) => p.id === forWhom.payer);
  /** P333: someone else paying makes it theirs and the recorder's only, so both are ticked. */
  const paidBy = (payer: string, guests = forWhom.guests): PersonalForWhom =>
    payer === meId
      ? { ...forWhom, guests, payer }
      : { guests, payer, draft: { ...forWhom.draft, chosen: true, selected: [meId, payer] } };
  const newGuest = (name: string) => ({ id: `new-${forWhom.guests.length + 1}`, name });
  return (
    <WhoPaidSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      description={props.title}
      payers={[{ value: meId, label: t("you") }, ...everyone.map((p) => ({ value: p.id, label: p.name }))]}
      payer={forWhom.payer}
      onPayer={(payer) => onForWhom(paidBy(payer))}
      onAddPayerByName={(name) => {
        const guest = newGuest(name);
        onForWhom(paidBy(guest.id, [...forWhom.guests, guest]));
      }}
      payerNote={paying ? t("otherPaid", { name: paying.first }) : null}
      accounts={paying ? null : props.accounts}
      accountId={props.accountId}
      onAccount={props.onAccount}
      people={[{ id: meId, name: t("you") }, ...everyone]}
      meId={meId}
      paidById={forWhom.payer}
      memberIds={props.memberIds}
      draft={forWhom.draft}
      onDraft={(draft: ShareDraft) => onForWhom({ ...forWhom, draft })}
      methods={["EQUAL", "EXACT", "PERCENT"]}
      amount={props.amount}
      currency={props.currency}
      formats={props.formats}
      planShares={null}
      // P333: a debt between two other people is not the recorder's to record.
      lockedReason={
        paying
          ? (id) => (id === meId || id === paying.id ? null : t("onlyBetween", { name: paying.first }))
          : undefined
      }
      onAddByName={
        paying
          ? undefined
          : (name) => {
              const guest = newGuest(name);
              onForWhom({
                ...forWhom,
                guests: [...forWhom.guests, guest],
                draft: { ...forWhom.draft, chosen: true, selected: [...forWhom.draft.selected, guest.id] },
              });
            }
      }
      hint={t("hint")}
      newAccount={
        props.newAccountHref && !paying
          ? { href: props.newAccountHref, label: tAccounts("new"), empty: tAccounts("picker.empty") }
          : undefined
      }
    />
  );
}
