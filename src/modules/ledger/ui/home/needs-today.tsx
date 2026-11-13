import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/shared/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";

/** Ruling P278: a shared space where it is the person's turn to put money in, and to whom she pays first. */
export interface Owe {
  readonly spaceId: string;
  /** The space's name. */
  readonly space: string;
  /** The person's member id there: Saldos' `?settle=` opens its settle sheet with her paying. */
  readonly memberId: string;
  /** What she puts in, positive. */
  readonly amount: MoneyDto;
  /** Whom she pays first (the settle-up suggestion), when that member is still in the space. */
  readonly to?: string | undefined;
}

/** #288: the bills of one space that wait for their real amount, the earliest one named. */
export interface PendingToday {
  readonly spaceId: string;
  /** The space's name. */
  readonly space: string;
  readonly count: number;
  /** The earliest one's description, its date and its suggested amount. */
  readonly name: string;
  readonly date: string;
  readonly amount: MoneyDto;
}

/** #288: a shared or direct space where the others owe the person, and how much. */
export interface OwedToday {
  readonly spaceId: string;
  readonly space: string;
  /** Positive. */
  readonly amount: MoneyDto;
}

/** Every action is a full 44 × 44 target, the short "Ver" included (AGENTS.md, UI). */
const ACTION = "flex min-h-11 min-w-11 shrink-0 items-center justify-end text-sm font-semibold text-accent";

/** The sum of the amounts when they share one currency; null across currencies, which never add up. */
const totalOf = (amounts: readonly MoneyDto[]): MoneyDto | null => {
  const [first] = amounts;
  if (!first || amounts.some((amount) => amount.currency !== first.currency)) return null;
  return {
    amount: amounts.reduce((sum, amount) => sum + BigInt(amount.amount), 0n).toString(),
    currency: first.currency,
  };
};

interface Line {
  readonly key: string;
  readonly title: ReactNode;
  readonly detail: string;
  readonly action: ReactNode;
}

/**
 * #288, as ruling P324 draws it at medium density (boards "Inicio personal" and "Inicio de Hogar"): what needs the person
 * today, as one action line between two hairlines under the hero, never a card. The line is the most pressing thing:
 * her turn to put money in ("Te toca poner $ X", Saldar opening Saldos' settle sheet), else a bill to confirm, else what
 * the others owe her. Anything else that needs her waits behind "N más", which opens the rest as flat rows in place,
 * each with the same way to act. Nothing to show, no line.
 */
export function NeedsToday({
  pending,
  owed,
  owes,
  today,
  formats,
}: {
  readonly pending: readonly PendingToday[];
  readonly owed: readonly OwedToday[];
  readonly owes: readonly Owe[];
  readonly today: string;
  readonly formats: Formats;
}) {
  const t = useTranslations("home.today");
  const owe = useTranslations("home.owe");
  const space = useTranslations("shell.space");
  const id = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const total = totalOf(owed.map((o) => o.amount));
  // "Ver" opens the Saldos of the space that owes her the most.
  const most = owed.reduce<OwedToday | undefined>(
    (top, o) => (top === undefined || BigInt(o.amount.amount) > BigInt(top.amount.amount) ? o : top),
    undefined,
  );
  const lines: Line[] = [
    ...owes.map((o) => ({
      key: `owe-${o.spaceId}`,
      title: (
        <>
          {space("owes")} <span className="whitespace-nowrap">{money(o.amount)}</span>
          {o.to ? <span className="sr-only"> {owe("to", { name: o.to })}</span> : null}
        </>
      ),
      detail: owe("in", { space: o.space }),
      action: (
        <Link
          href={`/spaces/${o.spaceId}/balances?settle=${encodeURIComponent(o.memberId)}`}
          aria-label={o.to ? owe("settleWith", { name: o.to, space: o.space }) : undefined}
          className={ACTION}
        >
          {owe("settle")}
        </Link>
      ),
    })),
    ...pending.map((p) => ({
      key: `pending-${p.spaceId}`,
      title: p.count === 1 ? t("pendingOne", { name: p.name }) : t("pendingMany", { count: p.count }),
      detail: t("pendingDetail", {
        space: p.space,
        when: p.date === today ? t("today") : t("since", { date: formatDate(p.date, formats) }),
        amount: money(p.amount),
      }),
      action: (
        <Link
          href={`/spaces/${p.spaceId}/pending-occurrences`}
          aria-label={t("reviewIn", { name: p.name, space: p.space })}
          className={ACTION}
        >
          {t("review")}
        </Link>
      ),
    })),
    ...(most
      ? [
          {
            key: "owed",
            title: total ? (
              <>
                {t("owed")} <span className="whitespace-nowrap">{money(total)}</span>
              </>
            ) : (
              t("owed")
            ),
            detail: owed.map((o) => `${o.space} ${money(o.amount)}`).join(" · "),
            action: (
              <Link href={`/spaces/${most.spaceId}/balances`} aria-label={t("seeOwed")} className={ACTION}>
                {t("see")}
              </Link>
            ),
          },
        ]
      : []),
  ];
  if (lines.length === 0) return null;
  const more = lines.length - 1;
  return (
    <section aria-labelledby={id} className="flex flex-col border-y border-line">
      <h2 id={id} className="sr-only">
        {t("title")}
      </h2>
      <ul id={listId} className="flex flex-col divide-y divide-line">
        {lines.map((line, i) => (
          <li key={line.key} hidden={i > 0 && !open} className="flex min-h-row items-center gap-3 py-1">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium [overflow-wrap:anywhere] text-ink">{line.title}</span>
              <span className="text-sm [overflow-wrap:anywhere] text-muted">{line.detail}</span>
            </span>
            {line.action}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((was) => !was)}
          className="flex min-h-11 items-center gap-1 self-start text-sm text-muted"
        >
          {open ? t("fewer") : t("more", { count: more })}
          <Icon
            name="chevronDown"
            size={18}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </button>
      ) : null}
    </section>
  );
}
