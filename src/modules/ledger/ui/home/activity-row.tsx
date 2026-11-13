import Link from "next/link";
import { useTranslations } from "next-intl";
import { CategoryIcon } from "@/modules/categories/ui";
import { Icon, paletteVars, SymbolIcon } from "@/shared/ui";
import type { ActivityItemDto, MoneyDto } from "@/shared/ui/api/dto";
import { formatDate, formatTimeAt, MINUS, type Formats } from "@/shared/ui/format/formatters";
import { zoneCity } from "@/shared/ui/format/zones";
import { relativeDay } from "@/shared/ui/time/when";
import { withTx } from "../detail/tx-href";
import { kindOf } from "../movement-kind";

const signed = (sign: "+" | "-" | null, amount: string) =>
  sign === "+" ? `+${amount}` : sign === "-" ? `${MINUS}${amount}` : amount;

type Title =
  | {
      readonly key:
        "settledByYou" | "settledToYou" | "forgivenByYou" | "forgivenToYou" | "giftByYou" | "giftToYou";
      readonly name: string;
    }
  | { readonly key: "settled" | "forgiven" | "gift"; readonly from: string; readonly to: string };

interface Part {
  readonly amount: MoneyDto;
  readonly sign: "+" | "-" | null;
  readonly detail: "shareOf" | "paidAndShare" | "paid" | "notYou" | "betweenYou" | "noMoney" | "recorded";
  /** A settlement without a description is named by who paid whom. */
  readonly title?: Title;
}

/** What the row says on its second line and the amount it shows, from the person's part of the movement. */
const partOf = (item: ActivityItemDto): Part => {
  const tx = item.transaction;
  const mine = new Set(item.you.memberIds);
  const name = (id: string | null) => (id ? (item.memberNames[id] ?? "") : "");
  if (tx.type === "EXPENSE") {
    const { share, paid } = item.you;
    if (share) return { amount: share, sign: "-" as const, detail: paid ? "paidAndShare" : "shareOf" };
    if (paid) return { amount: paid, sign: "-" as const, detail: "paid" };
    return { amount: tx.amount, sign: null, detail: "notYou" };
  }
  if (tx.type === "SETTLEMENT") {
    const out = tx.payerMemberId !== null && mine.has(tx.payerMemberId);
    const into = tx.receivingMemberId !== null && mine.has(tx.receivingMemberId);
    // Ruling P322: a forgiven debt and a gift move no money, so they carry no sign; their words say what happened.
    // Both run from the one let off to the one who lets them off: the debtor to the creditor, the one given to the giver.
    if (tx.settlementReason === "FORGIVENESS" || tx.settlementReason === "GIFT") {
      const key = tx.settlementReason === "FORGIVENESS" ? "forgiven" : "gift";
      return {
        amount: tx.amount,
        sign: null,
        detail: "noMoney",
        title: into
          ? ({ key: `${key}ByYou`, name: name(tx.payerMemberId) } as const)
          : out
            ? ({ key: `${key}ToYou`, name: name(tx.receivingMemberId) } as const)
            : ({ key, from: name(tx.payerMemberId), to: name(tx.receivingMemberId) } as const),
      };
    }
    return {
      amount: tx.amount,
      sign: out ? ("-" as const) : into ? ("+" as const) : null,
      detail: out || into ? "betweenYou" : "recorded",
      title: out
        ? ({ key: "settledByYou", name: name(tx.receivingMemberId) } as const)
        : into
          ? ({ key: "settledToYou", name: name(tx.payerMemberId) } as const)
          : ({ key: "settled", from: name(tx.payerMemberId), to: name(tx.receivingMemberId) } as const),
    };
  }
  if (tx.type === "INCOME") {
    const into = tx.receivingMemberId !== null && mine.has(tx.receivingMemberId);
    return { amount: tx.amount, sign: into ? ("+" as const) : null, detail: "recorded" };
  }
  const out = tx.payerMemberId !== null && mine.has(tx.payerMemberId);
  return { amount: tx.amount, sign: out ? ("-" as const) : null, detail: "recorded" };
};

/**
 * Ruling P306 (boards "Inicio personal · todo en un lugar"), amended by P324: a movement of a shared or direct space in
 * the personal Inicio's Recientes. One line names its day, its space and the person's part once: "Ayer · Hogar · tu
 * parte". The amount is the person's part with its sign; a movement without them says "no te incluye" and shows its
 * amount grey and unsigned, never color alone. The row opens the movement in its own space.
 */
export function ActivityRow({
  item,
  formats,
  viewerZone,
  today,
  money,
  card = false,
}: {
  readonly item: ActivityItemDto;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly today: string;
  /** Inicio's money formatter, from the person's formats. */
  readonly money: (amount: MoneyDto) => string;
  /** Ruling P319, amended by P324: a row of the personal Movimientos, under its day's label, so it names no day. */
  readonly card?: boolean;
}) {
  const t = useTranslations("home.feed");
  const ledger = useTranslations("ledger");
  const tx = item.transaction;
  const part = partOf(item);
  const day = relativeDay(tx.date, today);
  const when: string[] = [];
  if (card) {
    // Ruling P324: Movimientos states the day in its label, so the row keeps only the time, as its own rows do.
    if (tx.occurredAt && tx.timeZone) {
      const time = formatTimeAt(tx.occurredAt, tx.timeZone, formats);
      when.push(tx.timeZone === viewerZone ? time : `${time} · ${zoneCity(tx.timeZone)}`);
    }
  } else {
    when.push(day === "today" || day === "yesterday" ? ledger(`day.${day}`) : formatDate(tx.date, formats));
    if (day === "today" && tx.occurredAt && tx.timeZone && tx.timeZone === viewerZone)
      when.push(formatTimeAt(tx.occurredAt, tx.timeZone, formats));
  }
  // Ruling P324 (board "Inicio personal"): the amount is the person's part, so the line names it once, "tu parte",
  // without repeating a figure or who recorded it.
  const detail =
    part.detail === "shareOf" || part.detail === "paidAndShare"
      ? ledger("yourPart")
      : part.detail === "paid"
        ? ledger("paidByYou")
        : part.detail === "notYou"
          ? t("notYou")
          : part.detail === "betweenYou"
            ? t("betweenYou")
            : part.detail === "noMoney"
              ? t("noMoney")
              : item.recordedBy.you
                ? t("recordedByYou")
                : item.recordedBy.name
                  ? t("recordedBy", { name: item.recordedBy.name })
                  : t("recorded");
  const named = part.title;
  const title =
    tx.description ||
    (named === undefined
      ? ledger(`type.${kindOf(tx)}`)
      : "from" in named
        ? t(named.key, { from: named.from, to: named.to })
        : t(named.key, { name: named.name }));
  const category = item.category;
  const icon =
    category?.icon && category.color ? (
      <CategoryIcon icon={category.icon} color={category.color} size={36} />
    ) : (
      <span
        aria-hidden="true"
        style={paletteVars("GRAPHITE")}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
      >
        {/* Boards "Inicio personal · todo en un lugar": a settlement between members wears the swap arrows. */}
        {tx.type === "SETTLEMENT" ? (
          <Icon name="swap" size={20} />
        ) : (
          <SymbolIcon name={tx.type === "TRANSFER" ? "cash" : "dots"} size={20} />
        )}
      </span>
    );
  const tone = part.sign === null ? "text-muted" : part.sign === "+" ? "text-accent" : "text-ink";
  return (
    <li data-activity-row>
      {/* Ruling P324: the same flat two-line row as the person's own, with no card and no border of its own. */}
      <Link
        href={withTx(`/spaces/${item.space.id}`, tx.id)}
        className="flex min-h-row-lg items-center gap-3 rounded-xl py-1.5"
      >
        <span className="shrink-0 overflow-hidden rounded-full">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium text-ink">{title}</span>
          {/* "Ayer · Hogar · tu parte": the space is named in words, so its color is never the only cue (AGENTS.md). */}
          <span className="text-[13px] break-words text-muted">
            {when.map((w) => `${w} · `).join("")}
            <span data-space-chip>{item.space.name}</span>
            {` · ${detail}`}
          </span>
        </span>
        <span className={`shrink-0 text-base font-semibold whitespace-nowrap ${tone}`}>
          {signed(part.sign, money(part.amount))}
        </span>
      </Link>
    </li>
  );
}
