import { useTranslations } from "next-intl";
import { categoryPath, CategoryIcon, findCategory } from "@/modules/categories/ui";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto, TransactionDto } from "@/shared/ui/api/dto";
import { formatMoney, formatTimeAt, MINUS, type Formats } from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";

/** What every row needs to read a transaction (serializable: the server list and "Load more" share it). */
export interface RowContext {
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly groups: CategoryGroupDto[];
  readonly accountNames: Record<string, string>;
  /** Member id to display name; empty in a personal space, where nobody else pays (ruling P171). */
  readonly memberNames: Record<string, string>;
}

/** HU-E9-03, the Activity artboard's row: no "use client" and no server import, so both sides render it. */
export function TransactionRow({
  tx,
  context,
}: {
  readonly tx: TransactionDto;
  readonly context: RowContext;
}) {
  const t = useTranslations("ledger");
  const { formats, viewerZone, groups, accountNames, memberNames } = context;
  const name = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (id ? (memberNames[id] ?? "") : "");
  const found = tx.categoryId ? findCategory(groups, tx.categoryId) : null;
  const meta: string[] = [];
  // The payer of a shared expense reads on its own line: a long name wraps there instead of being cut (S1).
  let payerLine = "";
  if (tx.occurredAt && tx.timeZone) {
    const time = formatTimeAt(tx.occurredAt, tx.timeZone, formats);
    meta.push(tx.timeZone === viewerZone ? time : `${time} · ${zoneCity(tx.timeZone)}`);
  }
  if (tx.type === "TRANSFER")
    meta.push(t("transfer", { from: name(tx.sourceAccountId), to: name(tx.destinationAccountId) }));
  else if (tx.type === "SETTLEMENT")
    meta.push(t("settlement", { from: member(tx.payerMemberId), to: member(tx.receivingMemberId) }));
  else {
    const path = tx.categoryId ? categoryPath(groups, tx.categoryId) : null;
    if (path) meta.push(path);
    const paid = tx.payments[0];
    // Ruling P171: a shared expense names who paid (a member, or the fund that paid with no member).
    const payer =
      tx.type === "EXPENSE" && paid ? (paid.memberId ? member(paid.memberId) : name(paid.accountId)) : "";
    if (payer) payerLine = t("paidBy", { name: payer });
    else {
      const account = tx.type === "INCOME" ? tx.destinationAccountId : (paid?.accountId ?? null);
      if (name(account)) meta.push(name(account));
    }
  }
  const money = formatMoney(tx.amount, formats);
  const amount = tx.type === "EXPENSE" ? `${MINUS}${money}` : tx.type === "INCOME" ? `+${money}` : money;
  return (
    <li className="flex min-h-16 items-center gap-3 py-2">
      {found ? (
        <CategoryIcon icon={found.category.icon} color={found.category.color} size={40} />
      ) : (
        <span
          aria-hidden="true"
          style={paletteVars("GRAPHITE")}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
        >
          <SymbolIcon name={tx.type === "TRANSFER" ? "cash" : "dots"} size={22} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-ink">{tx.description || t(`type.${tx.type}`)}</span>
        {meta.length > 0 ? <span className="truncate text-sm text-muted">{meta.join(" · ")}</span> : null}
        {payerLine ? <span className="text-sm break-words text-muted">{payerLine}</span> : null}
      </span>
      <span
        className={
          tx.type === "EXPENSE" || tx.type === "INCOME"
            ? "shrink-0 font-semibold whitespace-nowrap text-ink"
            : "shrink-0 font-semibold whitespace-nowrap text-muted"
        }
      >
        {amount}
      </span>
    </li>
  );
}
