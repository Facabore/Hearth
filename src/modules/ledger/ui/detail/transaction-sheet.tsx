"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { categoryPath } from "@/modules/categories/ui";
import { memberLabel } from "@/modules/spaces/ui";
import { Button, Icon, ProblemNotice, Sheet } from "@/shared/ui";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatDate, formatMoney, formatTimeAt, MINUS } from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";
import { cameFrom, readTrail } from "@/shared/ui/navigation/history";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import type { RowContext } from "../transaction-row";
import type { TransactionDetail } from "./detail-loader";
import { actionsFor } from "./transaction-actions";

function Definition({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="font-medium break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * Rulings P189 and P190: a transaction's detail over the list that opened it. The address (`?tx=`) is the state, so
 * closing replaces it with `origin` and Back closes the sheet too. Editar goes to the edit route; Eliminar is wired
 * by the delete-with-undo task.
 */
export function TransactionSheet({
  spaceId,
  detail,
  context,
  origin,
}: {
  readonly spaceId: string;
  readonly detail: TransactionDetail;
  readonly context: RowContext;
  /** The page the sheet is over, without `tx`: where closing returns. */
  readonly origin: string;
}) {
  const t = useTranslations("ledger");
  const names = useTranslations("members");
  const problemMessage = useProblemMessage();
  const router = useRouter();
  const { tx, problem, members, viewer } = detail;
  const { formats, viewerZone, groups, accountNames } = context;
  // Opened by a push from the list: the entry before is the list, so closing goes back to it and Back then leaves the
  // list to where the person was. A deep link or a reload has no such entry: closing replaces it (ruling P189).
  const close = (open: boolean) => {
    if (open) return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (cameFrom(readTrail(), here) === origin) router.back();
    else router.replace(origin, { scroll: false });
  };
  if (!tx) {
    return (
      <Sheet open onOpenChange={close} title={problem ? problemMessage(problem).message : ""}>
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
    // An account the viewer cannot read belongs to its payer: "Cuenta de Juan".
    const owner = memberOf(memberId);
    return id && owner ? t("detail.payerAccount", { name: owner.displayName }) : "";
  };

  const money = formatMoney(tx.amount, formats);
  const signed = tx.type === "EXPENSE" ? `${MINUS}${money}` : tx.type === "INCOME" ? `+${money}` : money;
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
  // The account rows of a type: Cuenta, Cuenta que recibe, or Desde and Hacia (a settlement names its members).
  const accounts: [string, string][] = [];
  const addAccount = (term: string, value: string) => {
    if (value) accounts.push([term, value]);
  };
  if (tx.type === "EXPENSE")
    addAccount(t("form.account"), paid ? accountOf(paid.accountId, paid.memberId) : "");
  else if (tx.type === "INCOME")
    addAccount(t("form.receivingAccount"), accountOf(tx.destinationAccountId, tx.receivingMemberId));
  else if (tx.type === "TRANSFER") {
    addAccount(t("form.from"), accountOf(tx.sourceAccountId, tx.payerMemberId));
    addAccount(t("form.to"), accountOf(tx.destinationAccountId, null));
  } else {
    addAccount(t("form.from"), labelOf(tx.payerMemberId));
    addAccount(t("form.to"), labelOf(tx.receivingMemberId));
  }
  const actions = actionsFor(tx, viewer, members);
  const note = actions.note;
  const noteText = note
    ? note.key === "onlyOwner"
      ? t("detail.note.onlyOwner", { name: note.name })
      : t(`detail.note.${note.key}`)
    : "";

  return (
    <Sheet
      open
      onOpenChange={close}
      title={tx.description || t(`type.${tx.type}`)}
      description={signed}
      footer={
        actions.edit || actions.delete ? (
          <div className="flex flex-col gap-3">
            {noteText ? <p className="text-sm text-muted">{noteText}</p> : null}
            <div
              className={
                actions.edit && actions.delete
                  ? "grid grid-cols-1 gap-3 min-[360px]:grid-cols-2"
                  : "grid gap-3"
              }
            >
              {actions.edit ? (
                <Button asChild variant="secondary" size="lg">
                  <Link href={withReturnTo(`/spaces/${spaceId}/transactions/${tx.id}/edit`, origin)}>
                    <Icon name="pencil" />
                    {t("detail.edit")}
                  </Link>
                </Button>
              ) : null}
              {actions.delete ? (
                <Button variant="danger" size="lg">
                  <Icon name="trash" />
                  {t("detail.delete")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null
      }
    >
      <dl className="flex flex-col gap-3 pb-1">
        <Definition term={t("detail.type")}>{t(`type.${tx.type}`)}</Definition>
        <Definition term={t("detail.when")}>
          {formatDate(tx.date, formats)} · {time}
        </Definition>
        {category ? <Definition term={t("form.category")}>{category}</Definition> : null}
        {accounts.map(([term, value]) => (
          <Definition key={term} term={term}>
            {value}
          </Definition>
        ))}
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
    </Sheet>
  );
}
