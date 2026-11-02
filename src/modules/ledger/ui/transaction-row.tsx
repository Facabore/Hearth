import Link from "next/link";
import { useTranslations } from "next-intl";
import { categoryPath, CategoryIcon, findCategory } from "@/modules/categories/ui";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto, TransactionDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, formatTimeAt, MINUS, type Formats } from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";
import { relativeDay } from "@/shared/ui/time/when";

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
  href,
  today,
  card = false,
}: {
  readonly tx: TransactionDto;
  readonly context: RowContext;
  /** Ruling P189: the row's detail, the same page with `?tx=`. Without it the row opens nothing. */
  readonly href?: string;
  /** Issue #216: the viewer's today, for a list whose rows are not under a day's heading; the row then names its day. */
  readonly today?: string;
  /**
   * Ruling P277 (board B1 06): Movimientos draws each row as a card of its own, with a round icon, a line that wraps so
   * the account shows whole, and an income in green beside its plus sign.
   */
  readonly card?: boolean;
}) {
  const t = useTranslations("ledger");
  const { formats, viewerZone, groups, accountNames, memberNames } = context;
  const name = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (id ? (memberNames[id] ?? "") : "");
  const found = tx.categoryId ? findCategory(groups, tx.categoryId) : null;
  const meta: string[] = [];
  // The payer of a shared expense reads on its own line: a long name wraps there instead of being cut (S1).
  let payerLine = "";
  // Issue #216: a list not grouped by day names it: "Hoy · 14:32", "Ayer", then the date; only today keeps its time.
  const day = today === undefined ? null : relativeDay(tx.date, today);
  if (today !== undefined)
    meta.push(day === "today" || day === "yesterday" ? t(`day.${day}`) : formatDate(tx.date, formats));
  if (tx.occurredAt && tx.timeZone && (today === undefined || day === "today")) {
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
  const icon = found ? (
    <CategoryIcon icon={found.category.icon} color={found.category.color} size={40} />
  ) : (
    <span
      aria-hidden="true"
      style={paletteVars("GRAPHITE")}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
    >
      <SymbolIcon name={tx.type === "TRANSFER" ? "cash" : "dots"} size={22} />
    </span>
  );
  const tone =
    card && tx.type === "INCOME"
      ? "text-accent"
      : tx.type === "EXPENSE" || tx.type === "INCOME"
        ? "text-ink"
        : "text-muted";
  const content = (
    <>
      {card ? <span className="shrink-0 overflow-hidden rounded-full">{icon}</span> : icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={card ? "font-medium break-words text-ink" : "truncate font-medium text-ink"}>
          {tx.description || t(`type.${tx.type}`)}
        </span>
        {meta.length > 0 ? (
          <span className={card ? "text-sm break-words text-muted" : "truncate text-sm text-muted"}>
            {meta.join(" · ")}
          </span>
        ) : null}
        {payerLine ? <span className="text-sm break-words text-muted">{payerLine}</span> : null}
      </span>
      <span className={`shrink-0 font-semibold whitespace-nowrap ${tone}`}>{amount}</span>
    </>
  );
  const box = card ? "rounded-2xl bg-surface px-3" : "";
  const pad = card ? "py-3" : "py-1.5";
  // The link wraps the row's whole text, so its name holds the visible label (WCAG 2.5.3) and the target is the row.
  return href ? (
    <li className={box || undefined}>
      <Link href={href} scroll={false} className={`flex min-h-row-lg items-center gap-3 rounded-xl ${pad}`}>
        {content}
      </Link>
    </li>
  ) : (
    <li className={`flex min-h-row-lg items-center gap-3 ${pad} ${box}`.trim()}>{content}</li>
  );
}
