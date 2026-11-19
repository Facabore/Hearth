"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, type ReactNode } from "react";
import { categoryPath } from "@/modules/categories/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, Icon, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import {
  formatDate,
  formatDirectedMoney,
  formatMoney,
  formatTime,
  formatTimeAt,
  type Formats,
} from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { nowIn } from "@/shared/ui/time/when";
import type { RowContext } from "../transaction-row";
import type { TransactionDetail } from "./transaction-detail";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import { historyOf, type HistoryChange } from "./history";
import { actionsFor, type TransactionActions } from "./transaction-actions";
import { useDeleteWithUndo } from "./use-delete-with-undo";

function Definition({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="font-medium break-words text-ink">{children}</dd>
    </div>
  );
}

/** Editar goes to the edit route; Eliminar deletes at once and offers to undo it (ruling P194). */
function Actions({
  spaceId,
  tx,
  origin,
  editHref,
  actions,
  noteText,
  api: injected,
}: {
  readonly spaceId: string;
  readonly tx: TransactionDto;
  readonly origin: string;
  readonly editHref: string;
  readonly actions: TransactionActions;
  readonly noteText: string;
  readonly api?: Api;
}) {
  const t = useTranslations("ledger.detail");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const { remove, pending, problem } = useDeleteWithUndo({
    api,
    spaceId,
    tx,
    origin,
  });
  return (
    <div className="flex flex-col gap-3">
      {noteText ? <p className="text-sm text-muted">{noteText}</p> : null}
      {problem ? <ProblemNotice problem={problem} /> : null}
      <div
        className={
          actions.edit && actions.delete ? "grid grid-cols-1 gap-3 min-[360px]:grid-cols-2" : "grid gap-3"
        }
      >
        {actions.edit ? (
          <Button asChild variant="secondary" size="lg">
            <Link href={editHref}>
              <Icon name="pencil" />
              {t("edit")}
            </Link>
          </Button>
        ) : null}
        {actions.delete ? (
          <Button variant="danger" size="lg" disabled={pending} onClick={() => void remove()}>
            <Icon name="trash" />
            {t("delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ruling P344 (S7, board 2): who changed the movement, what and when, newest first, ending with who recorded it. A
 * value is shown "from → to" only where it can be named: a member, an amount, a date, an account the viewer reads.
 */
function History({
  tx,
  entries,
  viewerUserId,
  nameOfMember,
  nameOfAccount,
  nameOfCategory,
  formats,
  zone,
}: {
  readonly tx: TransactionDto;
  readonly entries: NonNullable<TransactionDetail["history"]>;
  readonly viewerUserId: string;
  readonly nameOfMember: (memberId: string) => string | undefined;
  readonly nameOfAccount: (accountId: string) => string | undefined;
  readonly nameOfCategory: (categoryId: string) => string | undefined;
  readonly formats: Formats;
  readonly zone: string;
}) {
  const t = useTranslations("ledger");
  const id = useId();
  const kind = tx.type === "TRANSFER" && tx.payerMemberId !== null ? "FUND_CONTRIBUTION" : tx.type;
  const valueOf = (field: HistoryChange["field"], value: string | null): string | undefined => {
    if (value === null)
      return field === "account"
        ? t("edit.unassigned")
        : field === "description"
          ? t("detail.noDescription")
          : undefined;
    if (field === "payer" || field === "receiver") return nameOfMember(value);
    if (field === "amount") return formatMoney({ amount: value, currency: tx.amount.currency }, formats);
    if (field === "date") return formatDate(value, formats);
    if (field === "account") return nameOfAccount(value);
    if (field === "category") return nameOfCategory(value);
    return field === "description" ? value : undefined;
  };
  return (
    <section className="flex flex-col gap-1 pt-2">
      <h3 id={id} className="text-sm text-muted">
        {t("history.title")}
      </h3>
      <ul aria-labelledby={id} className="flex flex-col">
        {historyOf(tx, entries).map((line) => {
          const who = line.actorUserId === viewerUserId ? "me" : "other";
          const actor = line.actorName ?? nameOfMember(line.actorUserId) ?? t("history.someone");
          const did = t("history.did", { who, actor, action: line.action });
          const sentences =
            line.changes.length === 0
              ? [`${did} ${t("history.thing", { kind })}`]
              : line.changes.map((change) => {
                  const said = `${did} ${t("history.field", { field: change.field })}`;
                  const from = change.from === undefined ? undefined : valueOf(change.field, change.from);
                  const to = change.to === undefined ? undefined : valueOf(change.field, change.to);
                  return from !== undefined && to !== undefined
                    ? t("history.fromTo", { change: said, from, to })
                    : said;
                });
          const at = nowIn(new Date(line.at), zone);
          return (
            <li key={line.id} className="flex flex-col border-b border-line py-2 last:border-b-0">
              {sentences.map((sentence) => (
                <span key={sentence} className="break-words text-ink">
                  {sentence}{" "}
                </span>
              ))}
              <span className="text-sm text-muted">
                {t("history.at", { date: formatDate(at.date, formats), time: formatTime(at.wall, formats) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Rulings P189, P190 and P194: a transaction's detail over the list that opened it. The address (`?tx=`) is the state,
 * so closing leaves it for `origin` and Back closes the sheet too. Editar goes to the edit route; Eliminar deletes at
 * once and the toast offers Deshacer.
 */
export function TransactionSheet({
  spaceId,
  detail,
  context,
  origin,
  api,
}: {
  readonly spaceId: string;
  readonly detail: TransactionDetail;
  readonly context: RowContext;
  /** The page the sheet is over, without `tx`: where closing returns. */
  readonly origin: string;
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const names = useTranslations("members");
  const problemMessage = useProblemMessage();
  const router = useRouter();
  const { tx, problem, members, viewer, ownAccountNames } = detail;
  const { formats, viewerZone, groups, accountNames } = context;
  // Opened by a push from the list: the entry before is the list, so closing goes back to it and Back then leaves the
  // list to where the person was. A deep link or a reload has no such entry: closing replaces it (ruling P189).
  const close = (open: boolean) => {
    if (!open) leaveSheet(router, origin);
  };
  if (!tx) {
    return (
      <Sheet
        open
        historyEntry={false}
        onOpenChange={close}
        title={problem ? problemMessage(problem).message : ""}
      >
        {problem ? <ProblemNotice problem={problem} /> : null}
      </Sheet>
    );
  }

  const memberOf = (id: string | null) => members.find((m) => m.id === id);
  const labelOf = (id: string | null) => {
    const member = memberOf(id);
    return member ? memberLabel(member, viewer.userId, names) : "";
  };
  const accountOf = (id: string | null, memberId: string | null) => {
    if (id && accountNames[id]) return accountNames[id];
    // The viewer's own personal account, which pays in a shared space (issue #165).
    if (id && ownAccountNames[id]) return ownAccountNames[id];
    // An account the viewer cannot read belongs to its payer: "Cuenta de Juan".
    const owner = memberOf(memberId);
    return id && owner ? t("detail.payerAccount", { name: owner.displayName }) : "";
  };

  // Design Q4: a balance adjustment carries its direction's sign, as an expense and an income do (never color alone).
  const out = tx.type === "EXPENSE" || (tx.type === "ADJUSTMENT" && tx.destinationAccountId === null);
  const into = tx.type === "INCOME" || (tx.type === "ADJUSTMENT" && tx.destinationAccountId !== null);
  const signed = formatDirectedMoney(tx.amount, out ? "-" : into ? "+" : null, formats);
  const time =
    tx.occurredAt && tx.timeZone
      ? [
          formatTimeAt(tx.occurredAt, tx.timeZone, formats),
          ...(tx.timeZone === viewerZone ? [] : [zoneCity(tx.timeZone)]),
        ].join(" · ")
      : t("detail.noTime");
  const category = tx.categoryId ? categoryPath(groups, tx.categoryId) : null;
  const paid = tx.payments[0];
  const shared = members.length > 0;
  // P342 (board 4): an expense's paying account that moved another currency than the expense's, and whether it is the
  // viewer's ("Tu cuenta pagó 205.000 COP").
  const paidLeg = tx.type === "EXPENSE" && tx.payments.length === 1 ? paid?.accountAmount : undefined;
  const paidByViewer = !shared || memberOf(paid?.memberId ?? null)?.userId === viewer.userId;
  // The account rows of a type: Cuenta, Cuenta que recibe, or Desde and Hacia (a settlement names its members).
  const accounts: [string, string][] = [];
  const addAccount = (term: string, value: string) => {
    if (value) accounts.push([term, value]);
  };
  // D29, slice MC3 (boards 9 and 10): a leg in its own currency is shown beside its account ("Chase · 100 USD").
  const withLeg = (value: string, leg: TransactionDto["sourceAmount"]) =>
    value && leg ? `${value} · ${formatMoney(leg, formats)}` : value;
  if (tx.type === "EXPENSE")
    addAccount(
      t("form.account"),
      paid
        ? // P342: someone else's account that moved another currency carries its leg beside it, as an income's does.
          withLeg(accountOf(paid.accountId, paid.memberId), paidByViewer ? undefined : paidLeg)
        : "",
    );
  else if (tx.type === "INCOME")
    addAccount(
      t("form.receivingAccount"),
      withLeg(accountOf(tx.destinationAccountId, tx.receivingMemberId), tx.destinationAmount),
    );
  else if (tx.type === "TRANSFER") {
    addAccount(t("form.from"), withLeg(accountOf(tx.sourceAccountId, tx.payerMemberId), tx.sourceAmount));
    addAccount(t("form.to"), withLeg(accountOf(tx.destinationAccountId, null), tx.destinationAmount));
  } else if (tx.type === "ADJUSTMENT") {
    // Design Q4: the one account it adjusted, with its leg in its own currency.
    const leg = tx.destinationAccountId === null ? tx.sourceAmount : tx.destinationAmount;
    addAccount(
      t("form.account"),
      withLeg(accountOf(tx.destinationAccountId ?? tx.sourceAccountId, null), leg),
    );
  } else {
    addAccount(t("form.from"), labelOf(tx.payerMemberId));
    addAccount(t("form.to"), labelOf(tx.receivingMemberId));
    // P344 (board 2): each side's account, the viewer's by name and another's as theirs (P190); a forgiven debt has none.
    if (tx.settlementReason !== "FORGIVENESS") {
      addAccount(t("detail.leavesFrom"), accountOf(tx.sourceAccountId, tx.payerMemberId));
      addAccount(t("detail.arrivesAt"), accountOf(tx.destinationAccountId, tx.receivingMemberId));
    }
  }
  // Issue #223: a fund contribution is named as its row names it (`kindOf` in movement-kind.ts), and so is a forgiven
  // debt (P322). Kept inline: importing that module would pull a whole shared chunk into this sheet's (ADR 0004).
  const kind =
    tx.type === "TRANSFER" && tx.payerMemberId !== null
      ? "FUND_CONTRIBUTION"
      : tx.type === "SETTLEMENT" && tx.settlementReason === "FORGIVENESS"
        ? "FORGIVENESS"
        : tx.type;
  // Ruling P322: a payment made for someone says for whom, and whether it was given; a GIFT is the half of a gift that
  // the member it was made for "pays", so it names its payer.
  const forWhom =
    tx.type !== "SETTLEMENT"
      ? undefined
      : tx.settlementReason === "GIFT"
        ? memberOf(tx.payerMemberId)
        : tx.settlementReason !== "FORGIVENESS"
          ? memberOf(tx.onBehalfOfMemberId ?? null)
          : undefined;
  const typeName = forWhom
    ? t(tx.settlementReason === "GIFT" || tx.linkedTransactionId ? "detail.gaveFor" : "detail.paidFor", {
        name: forWhom.displayName,
      })
    : t(`type.${kind}`);
  const actions = actionsFor(tx, viewer, members);
  const editPath = `/spaces/${spaceId}/transactions/${tx.id}/edit`;
  const editHref = withReturnTo(editPath, origin);
  // P344 (S6, board 2): a side that is the viewer's and has no account says so, and opens its edit on the picker of
  // the viewer's own accounts for that side (S2).
  const mine = (memberId: string | null | undefined) => memberId != null && memberId === viewer.memberId;
  const unassigned: ("out" | "in")[] = !actions.edit
    ? []
    : tx.type === "EXPENSE"
      ? tx.payments.length === 1 && paid?.accountId === null && mine(paid.memberId)
        ? ["out"]
        : []
      : tx.type === "SETTLEMENT" && tx.settlementReason !== "FORGIVENESS"
        ? [
            ...(tx.sourceAccountId === null && mine(tx.payerMemberId) ? (["out"] as const) : []),
            ...(tx.destinationAccountId === null && mine(tx.receivingMemberId) ? (["in"] as const) : []),
          ]
        : kind === "FUND_CONTRIBUTION" && tx.sourceAccountId === null && mine(tx.payerMemberId)
          ? ["out"]
          : [];
  const note = actions.note;
  const noteText = note ? t(`detail.note.${note.key}`) : "";

  return (
    <Sheet
      open
      // Ruling P307: the sheet has an address of its own (P189), which Back already leaves.
      historyEntry={false}
      onOpenChange={close}
      title={tx.description || typeName}
      description={signed}
      footer={
        actions.edit || actions.delete ? (
          <Actions
            spaceId={spaceId}
            tx={tx}
            origin={origin}
            editHref={editHref}
            actions={actions}
            noteText={noteText}
            api={api}
          />
        ) : null
      }
    >
      <dl className="flex flex-col gap-3 pb-1">
        <Definition term={t("detail.type")}>{typeName}</Definition>
        <Definition term={t("detail.when")}>
          {formatDate(tx.date, formats)} · {time}
        </Definition>
        {category ? <Definition term={t("form.category")}>{category}</Definition> : null}
        {accounts.map(([term, value]) => (
          <Definition key={term} term={term}>
            {value}
          </Definition>
        ))}
        {unassigned.map((side) => (
          <div key={side}>
            <dt className="sr-only">{t(side === "out" ? "detail.leavesFrom" : "detail.arrivesAt")}</dt>
            <dd>
              <Link
                href={withReturnTo(`${editPath}?pick=${side}`, origin)}
                className="flex min-h-11 items-center gap-3 py-1 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-accent">{t("detail.unassigned")}</span>{" "}
                  <span className="text-sm text-muted">{t("detail.choose", { side })}</span>
                </span>
                <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
              </Link>
            </dd>
          </div>
        ))}
        {/* P342 (board 4): the expense stays in its own currency; this is what the paying account moved in its own. */}
        {paidLeg && paidByViewer ? (
          <Definition term={t("detail.yourAccountPaid")}>{formatMoney(paidLeg, formats)}</Definition>
        ) : null}
        <Definition term={t("form.description")}>{tx.description || t("detail.noDescription")}</Definition>
        {shared && tx.type === "EXPENSE" && paid ? (
          <Definition term={t("split.payer")}>
            {paid.memberId ? labelOf(paid.memberId) : (accountNames[paid.accountId ?? ""] ?? "")}
          </Definition>
        ) : null}
        {shared && tx.type === "EXPENSE" && tx.shares.length > 0 ? (
          <Definition term={t("split.split")}>
            <span className="block text-sm font-normal text-muted">
              {t(`split.methods.${tx.shares[0]!.splitMethod}`)}
            </span>
            <ul aria-label={t("split.split")} className="mt-1 flex flex-col gap-1">
              {tx.shares.map((share) => (
                <li key={share.memberId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">{labelOf(share.memberId)}</span>{" "}
                  <span className="shrink-0 whitespace-nowrap">{formatMoney(share.amount, formats)}</span>
                </li>
              ))}
            </ul>
          </Definition>
        ) : null}
      </dl>
      {detail.history ? (
        <History
          tx={tx}
          entries={detail.history}
          viewerUserId={viewer.userId}
          nameOfMember={(id) => (memberOf(id) ?? members.find((m) => m.userId === id))?.displayName}
          nameOfAccount={(id) => accountNames[id] ?? ownAccountNames[id]}
          nameOfCategory={(id) => categoryPath(groups, id) || undefined}
          formats={formats}
          zone={viewerZone}
        />
      ) : null}
    </Sheet>
  );
}
