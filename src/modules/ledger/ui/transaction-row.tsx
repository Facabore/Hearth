import Link from "next/link";
import { useTranslations } from "next-intl";
import { categoryPath, CategoryIcon, findCategory } from "@/modules/categories/ui";
import { paletteVars, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto, TransactionDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, formatTimeAt, MINUS, type Formats } from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";
import { relativeDay } from "@/shared/ui/time/when";
import { kindOf } from "./movement-kind";

/** What every row needs to read a transaction (serializable: the server list and "Load more" share it). */
export interface RowContext {
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly groups: CategoryGroupDto[];
  readonly accountNames: Record<string, string>;
  /** Member id to display name; empty in a personal space, where nobody else pays (ruling P171). */
  readonly memberNames: Record<string, string>;
  /** Ruling P324: the viewer's member id in a shared space, so a row says "pagaste tú" and "tu parte"; absent elsewhere. */
  readonly viewerMemberId?: string | null;
}

/**
 * HU-E9-03, the Activity artboard's row: no "use client" and no server import, so both sides render it. Ruling P324
 * (medium density): a flat row of at most two lines, the title and one line that states each fact once, and the
 * amount on the right; no card and no border of its own, the list draws the hairlines.
 */
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
   * Ruling P284 (board E9-09 00), amended by P324: a row of Movimientos, under its day's label. Its line names the time,
   * who paid or the account, and the viewer's share ("pagaste tú · tu parte $ 32.000"); an income shows in green beside
   * its plus sign. It is the same flat row as Inicio's (board "Inicio de Hogar"), whose line names the day and who paid.
   */
  readonly card?: boolean;
}) {
  const t = useTranslations("ledger");
  const { formats, viewerZone, groups, accountNames, memberNames } = context;
  const you = context.viewerMemberId ?? null;
  const name = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (id ? (memberNames[id] ?? "") : "");
  const found = tx.categoryId ? findCategory(groups, tx.categoryId) : null;
  const meta: string[] = [];
  let shareText: string | null = null;
  // Ruling P324: the round icon shows the category, so the line no longer names it; a screen reader still hears it.
  let category: string | null = null;
  // Issue #216: a list not grouped by day names it: "Hoy · 14:32", "Ayer", then the date; only today keeps its time.
  const day = today === undefined ? null : relativeDay(tx.date, today);
  if (today !== undefined)
    meta.push(day === "today" || day === "yesterday" ? t(`day.${day}`) : formatDate(tx.date, formats));
  // P324 (amends P284): Movimientos (`card`) groups rows by day and keeps them to two lines, so a row there leaves its
  // time to the detail sheet; only a record made in another zone still says when and where ("05:30 · Madrid").
  const elsewhere = tx.timeZone !== undefined && tx.timeZone !== null && tx.timeZone !== viewerZone;
  if (tx.occurredAt && tx.timeZone && (today === undefined || day === "today") && (!card || elsewhere)) {
    const time = formatTimeAt(tx.occurredAt, tx.timeZone, formats);
    meta.push(tx.timeZone === viewerZone ? time : `${time} · ${zoneCity(tx.timeZone)}`);
  }
  if (tx.type === "TRANSFER")
    meta.push(t("transfer", { from: name(tx.sourceAccountId), to: name(tx.destinationAccountId) }));
  else if (tx.type === "SETTLEMENT")
    meta.push(t("settlement", { from: member(tx.payerMemberId), to: member(tx.receivingMemberId) }));
  else {
    // #286 (audit pass 3, A12): a movement with no description is titled by its category, so it does not repeat it.
    const path = tx.categoryId && (tx.description || !found) ? categoryPath(groups, tx.categoryId) : null;
    // Inicio's rows named it before P324, so their accessible names keep it; Movimientos' never did (P284).
    if (path && !card) category = path;
    const paid = tx.payments[0];
    // Ruling P171: a shared expense names who paid (a member, or the fund that paid with no member); P324: the viewer
    // reads "pagaste tú".
    const payer =
      tx.type === "EXPENSE" && paid ? (paid.memberId ? member(paid.memberId) : name(paid.accountId)) : "";
    if (tx.type === "EXPENSE" && you !== null && paid?.memberId === you) meta.push(t("paidByYou"));
    else if (payer) meta.push(t("paidBy", { name: payer }));
    else {
      const account = tx.type === "INCOME" ? tx.destinationAccountId : (paid?.accountId ?? null);
      // Board B1 03: Inicio names the account only when no category names the row, as in "1 oct · Bancolombia".
      if (name(account) && (card || !path)) meta.push(name(account));
    }
    // Ruling P324 (board "Movimientos"): the row shows the whole amount, so its line adds the viewer's share once,
    // unless the share is the whole amount.
    const share =
      card && tx.type === "EXPENSE" && you !== null ? tx.shares.find((s) => s.memberId === you) : undefined;
    if (share && share.amount.amount !== tx.amount.amount)
      shareText = t("yourShare", { share: formatMoney(share.amount, formats) });
  }
  const kind = kindOf(tx);
  const money = formatMoney(tx.amount, formats);
  const amount = tx.type === "EXPENSE" ? `${MINUS}${money}` : tx.type === "INCOME" ? `+${money}` : money;
  const icon = found ? (
    <CategoryIcon icon={found.category.icon} color={found.category.color} size={36} />
  ) : (
    <span
      aria-hidden="true"
      style={paletteVars("GRAPHITE")}
      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
    >
      <SymbolIcon name={tx.type === "TRANSFER" ? "cash" : "dots"} size={20} />
    </span>
  );
  const tone =
    card && tx.type === "INCOME"
      ? "text-accent"
      : tx.type === "EXPENSE" || tx.type === "INCOME"
        ? "text-ink"
        : "text-muted";
  const line = meta.join(" · ");
  const rest = shareText ? (line ? `${line} · ` : "") : line;
  // Ruling P324: 48 px for a row of one line, 56 px for two.
  const height = line || shareText ? "min-h-row-lg" : "min-h-row";
  const content = (
    <>
      {/* Boards B1 03, E9-09 00 and P324: a 36 px round icon in every list. */}
      <span className="shrink-0 overflow-hidden rounded-full">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-base font-medium text-ink">
          {tx.description || found?.category.name || t(`type.${kind}`)}
        </span>
        {shareText ? (
          // P324 (board "Movimientos"): one line, whose share never breaks; only the payer's words give way, and
          // the whole text stays in the link's name.
          <span className="flex min-w-0 text-[13px] text-muted">
            {rest ? <span className="min-w-0 truncate whitespace-pre">{rest}</span> : null}
            <span className="shrink-0 whitespace-nowrap">{shareText}</span>
          </span>
        ) : line ? (
          // A long name wraps within the line instead of being cut (P284, S1).
          <span className="text-[13px] break-words text-muted">
            {line}
            {category ? <span className="sr-only"> · {category}</span> : null}
          </span>
        ) : category ? (
          <span className="sr-only">{category}</span>
        ) : null}
      </span>
      <span className={`shrink-0 text-base font-semibold whitespace-nowrap ${tone}`}>{amount}</span>
    </>
  );
  // The link wraps the row's whole text, so its name holds the visible label (WCAG 2.5.3) and the target is the row.
  return href ? (
    <li>
      <Link href={href} scroll={false} className={`flex ${height} items-center gap-3 rounded-xl py-1.5`}>
        {content}
      </Link>
    </li>
  ) : (
    <li className={`flex ${height} items-center gap-3 py-1.5`}>{content}</li>
  );
}
