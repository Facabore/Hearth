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
  maskedAmount,
}: {
  readonly tx: TransactionDto;
  readonly context: RowContext;
  /** Ruling P189: the row's detail, the same page with `?tx=`. Without it the row opens nothing. */
  readonly href?: string;
  /** Issue #216: the viewer's today, for a list whose rows are not under a day's heading; the row then names its day. */
  readonly today?: string;
  /**
   * Ruling P284 (board E9-09 00, amending P277): a row of Movimientos, inside its day's card. Its line names the time
   * and who paid or the account, no category, and wraps rather than cut a long name; an income shows in green beside
   * its plus sign. Inicio's rows (board B1 03) name the category and no account beside it, and truncate.
   */
  readonly card?: boolean;
  /** Ruling P278: what Inicio shows instead of the amount while its eye hides them, in the text a screen reader reads. */
  readonly maskedAmount?: string;
}) {
  const t = useTranslations("ledger");
  const { formats, viewerZone, groups, accountNames, memberNames } = context;
  const name = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (id ? (memberNames[id] ?? "") : "");
  const found = tx.categoryId ? findCategory(groups, tx.categoryId) : null;
  const meta: string[] = [];
  // A long payer name wraps within the line instead of being cut (S1).
  let payerNamed = false;
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
    // Ruling P284 (boards E9-09 00 and 12): Movimientos reads "9:15 · pagó Ana" or "12:40 · Nequi"; its icon shows the
    // category, so the line keeps room for the payer. Inicio (board B1 03) names the category instead.
    if (path && !card) meta.push(path);
    const paid = tx.payments[0];
    // Ruling P171: a shared expense names who paid (a member, or the fund that paid with no member).
    const payer =
      tx.type === "EXPENSE" && paid ? (paid.memberId ? member(paid.memberId) : name(paid.accountId)) : "";
    // Ruling P284: the payer follows the time on the same line, "9:15 · pagó Ana", never on a line of its own.
    if (payer) {
      meta.push(t("paidBy", { name: payer }));
      payerNamed = true;
    } else {
      const account = tx.type === "INCOME" ? tx.destinationAccountId : (paid?.accountId ?? null);
      // Board B1 03: Inicio names the account only when no category names the row, as in "1 oct · Bancolombia".
      if (name(account) && (card || !path)) meta.push(name(account));
    }
  }
  // Issue #223 (ruling P283): a contribution to the shared fund is a TRANSFER that names its contributor (HU-E4-09).
  const kind = tx.type === "TRANSFER" && tx.payerMemberId !== null ? "FUND_CONTRIBUTION" : tx.type;
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
      {/* Boards B1 03 and E9-09 00: the icon is round in both lists. */}
      <span className="shrink-0 overflow-hidden rounded-full">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={card ? "font-medium break-words text-ink" : "truncate font-medium text-ink"}>
          {tx.description || t(`type.${kind}`)}
        </span>
        {meta.length > 0 ? (
          <span
            className={card || payerNamed ? "text-sm break-words text-muted" : "truncate text-sm text-muted"}
          >
            {meta.join(" · ")}
          </span>
        ) : null}
      </span>
      <span className={`shrink-0 font-semibold whitespace-nowrap ${tone}`}>{maskedAmount ?? amount}</span>
    </>
  );
  // Ruling P284: Movimientos's rows share their day's card, which draws the surface and the dividers.
  const pad = card ? "px-3 py-3" : "py-1.5";
  // The link wraps the row's whole text, so its name holds the visible label (WCAG 2.5.3) and the target is the row.
  return href ? (
    <li>
      <Link href={href} scroll={false} className={`flex min-h-row-lg items-center gap-3 rounded-xl ${pad}`}>
        {content}
      </Link>
    </li>
  ) : (
    <li className={`flex min-h-row-lg items-center gap-3 ${pad}`}>{content}</li>
  );
}
