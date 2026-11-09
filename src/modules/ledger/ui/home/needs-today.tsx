import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
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

const LINK = "flex min-h-11 min-w-11 shrink-0 items-center justify-center text-sm font-medium text-accent";

/** The sum of the amounts when they share one currency; null across currencies, which never add up. */
const totalOf = (amounts: readonly MoneyDto[]): MoneyDto | null => {
  const [first] = amounts;
  if (!first || amounts.some((amount) => amount.currency !== first.currency)) return null;
  return {
    amount: amounts.reduce((sum, amount) => sum + BigInt(amount.amount), 0n).toString(),
    currency: first.currency,
  };
};

function Row({
  initial,
  tone,
  title,
  detail,
  action,
}: {
  readonly initial: string;
  readonly tone: "track" | "accent" | "owe";
  readonly title: ReactNode;
  readonly detail: string;
  readonly action: ReactNode;
}) {
  const circle = {
    track: "bg-track text-ink",
    accent: "bg-accent-soft text-accent",
    owe: "bg-owe-soft text-owe-ink",
  };
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        aria-hidden="true"
        className={`flex size-10 shrink-0 items-center justify-center rounded-full font-semibold ${circle[tone]}`}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold [overflow-wrap:anywhere] text-ink">{title}</span>
        <span className="text-sm [overflow-wrap:anywhere] text-muted">{detail}</span>
      </span>
      {action}
    </li>
  );
}

/**
 * #288 (audit pass 3, A9 and A10; board "Propuesta · Inicio personal · te necesita hoy", approved 2026-11-09): what
 * needs the person today, in one card under the plan: each space's bills to confirm, what the others owe her, and each
 * space where it is her turn to put money in (ruling P278's card, now a row). Nothing to show, no card.
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
  if (pending.length + owed.length + owes.length === 0) return null;
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const total = totalOf(owed.map((o) => o.amount));
  // "Ver" opens the Saldos of the space that owes her the most.
  const most = owed.reduce<OwedToday | undefined>(
    (top, o) => (top === undefined || BigInt(o.amount.amount) > BigInt(top.amount.amount) ? o : top),
    undefined,
  );
  return (
    <section aria-labelledby={id} className="flex flex-col rounded-2xl bg-surface px-3 pt-3 pb-1">
      <h2 id={id} className="font-semibold text-ink">
        {t("title")}
      </h2>
      <ul className="flex flex-col">
        {pending.map((p) => (
          <Row
            key={`pending-${p.spaceId}`}
            initial={p.name.trim().charAt(0).toUpperCase()}
            tone="track"
            title={p.count === 1 ? t("pendingOne", { name: p.name }) : t("pendingMany", { count: p.count })}
            detail={t("pendingDetail", {
              space: p.space,
              when: p.date === today ? t("today") : t("since", { date: formatDate(p.date, formats) }),
              amount: money(p.amount),
            })}
            action={
              <Link
                href={`/spaces/${p.spaceId}/pending-occurrences`}
                aria-label={t("reviewIn", { name: p.name, space: p.space })}
                className={LINK}
              >
                {t("review")}
              </Link>
            }
          />
        ))}
        {most ? (
          <Row
            initial="+"
            tone="accent"
            title={
              total ? (
                <>
                  {t("owed")} <span className="whitespace-nowrap text-accent">{money(total)}</span>
                </>
              ) : (
                t("owed")
              )
            }
            detail={owed.map((o) => `${o.space} ${money(o.amount)}`).join(" · ")}
            action={
              <Link href={`/spaces/${most.spaceId}/balances`} aria-label={t("seeOwed")} className={LINK}>
                {t("see")}
              </Link>
            }
          />
        ) : null}
        {owes.map((o) => (
          <Row
            key={`owe-${o.spaceId}`}
            initial={(o.to ?? o.space).trim().charAt(0).toUpperCase()}
            tone="owe"
            title={
              <>
                {space("owes")} <span className="whitespace-nowrap text-owe-ink">{money(o.amount)}</span>
                {o.to ? <span className="sr-only"> {owe("to", { name: o.to })}</span> : null}
              </>
            }
            detail={owe("in", { space: o.space })}
            action={
              <Link
                href={`/spaces/${o.spaceId}/balances?settle=${encodeURIComponent(o.memberId)}`}
                aria-label={o.to ? owe("settleWith", { name: o.to, space: o.space }) : undefined}
                className="flex min-h-11 shrink-0 items-center rounded-full bg-owe px-5 text-sm font-semibold text-on-accent"
              >
                {owe("settle")}
              </Link>
            }
          />
        ))}
      </ul>
    </section>
  );
}
