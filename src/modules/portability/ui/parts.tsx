"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Icon, ProblemNotice } from "@/shared/ui";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDayMonthYear } from "@/shared/ui/format/day-month";
import type { DateFormat, NumberFormat } from "@/shared/ui/format/formatters";

/** The person's display formats (D23) these screens read: numbers and dates. */
export interface ScreenFormats {
  readonly numberFormat: NumberFormat;
  readonly dateFormat: DateFormat;
}

/** A refusal and, when the API says why (`details.reason`, D28's InvalidImportMapping), its reason. */
export interface Refusal {
  readonly problem: Problem;
  readonly reason: string | null;
}

const reasonOf = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" && reason !== "" ? reason : null;
};

/**
 * One call to /api/v1 at a time: `pending` while it runs, and its refusal (or a network failure, as `Unknown`) kept
 * for the screen to show. `run` answers the data, or null when the call was refused.
 */
export const useCall = () => {
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const run = async <T,>(
    send: () => Promise<{ data?: T; error?: unknown; response: Response }>,
  ): Promise<T | null> => {
    setPending(true);
    setRefusal(null);
    try {
      const { data, error, response } = await send();
      if (response.ok) return (data ?? null) as T | null;
      setRefusal({ problem: problemFrom(error, response), reason: reasonOf(error) });
    } catch (error) {
      setRefusal({ problem: problemFrom(error, undefined), reason: null });
    } finally {
      setPending(false);
    }
    return null;
  };
  return { pending, refusal, run, clear: () => setRefusal(null) };
};

/**
 * A refusal in the person's language (P118): its code's message, the reason's own line when the catalog has one, and
 * `tooMany` instead of the sign-in's wording when the API asks to wait (429).
 */
export function RefusalNotice({
  refusal,
  tooMany,
}: {
  readonly refusal: Refusal;
  readonly tooMany?: string;
}) {
  const t = useTranslations("portability.reason");
  if (refusal.problem.code === "TooManyRequests" && tooMany) {
    return (
      <div role="alert" className="flex gap-2 rounded-xl border border-danger p-3 text-sm text-danger">
        <Icon name="alert" size={18} />
        <p>{tooMany}</p>
      </div>
    );
  }
  const known = refusal.reason !== null && t.has(refusal.reason as "currencyMismatch");
  return (
    <ProblemNotice
      problem={refusal.problem}
      detail={known ? t(refusal.reason as "currencyMismatch") : undefined}
    />
  );
}

/** "6 may 2025": a local date in the person's date format, the year left out in today's year (P327). */
export const useDateLabel = (formats: ScreenFormats, today: string) => {
  const t = useTranslations("common.monthShort");
  return (isoDate: string) =>
    formatDayMonthYear(isoDate, t(`${Number(isoDate.slice(5, 7)) as 1}`), formats, today);
};

/** "Visa Oro, Cuenta en dólares y Préstamo a Juan"; past `max` names, "… y 3 más". */
export const useNameList = () => {
  const t = useTranslations("portability");
  return (names: readonly string[], max = 3): string => {
    if (names.length <= 1) return names[0] ?? "";
    if (names.length > max)
      return t("andMore", { list: names.slice(0, max).join(", "), count: names.length - max });
    return t("and", { list: names.slice(0, -1).join(", "), last: names.at(-1)! });
  };
};

/** The round icon a row of these boards leads with. */
export function RowIcon({
  children,
  tone = "accent",
}: {
  readonly children: ReactNode;
  readonly tone?: "accent" | "warn";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone === "warn" ? "bg-owe-soft text-owe-ink" : "bg-accent-soft text-accent"}`}
    >
      {children}
    </span>
  );
}

const ROW = "flex min-h-row-lg w-full items-center gap-3 py-2 text-left";

/** A row's title, its note under it, and what trails it; the title and note wrap their words. */
function RowBody({
  title,
  note,
  trailing,
  muted,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly trailing?: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
        <span className={`text-[15px] ${muted ? "text-muted" : "text-ink"}`}>{title}</span>
        {note ? <span className="text-[13px] text-muted">{note}</span> : null}
      </span>
      {trailing}
    </>
  );
}

const Chevron = () => <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />;

/** A row that opens another screen: the whole row is the 44 px target. */
export function LinkRow({
  href,
  icon,
  title,
  note,
  action,
}: {
  readonly href: string;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: string;
}) {
  return (
    <Link href={href} className={ROW}>
      {icon}
      <RowBody
        title={title}
        note={note}
        trailing={
          <>
            {action ? <span className="shrink-0 text-sm font-semibold text-accent">{action}</span> : null}
            <Chevron />
          </>
        }
      />
    </Link>
  );
}

/** A row that opens a sheet on this screen. */
export function ButtonRow({
  onClick,
  icon,
  title,
  note,
}: {
  readonly onClick: () => void;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      {icon}
      <RowBody title={title} note={note} trailing={<Chevron />} />
    </button>
  );
}

/** A row that leads nowhere yet (a source still to come): muted, and no target. */
export function StaticRow({
  icon,
  title,
  note,
  muted,
}: {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <div className={ROW}>
      {icon}
      <RowBody title={title} note={note} muted={muted} />
    </div>
  );
}

/** A section's small heading in capitals, as the boards draw them. */
export function SectionTitle({ id, children }: { readonly id?: string; readonly children: ReactNode }) {
  return (
    <h2 id={id} className="pt-2 text-xs font-semibold tracking-wide text-muted uppercase">
      {children}
    </h2>
  );
}

/** The screen's main action, pinned at the bottom while the content scrolls above it (#281). */
export function Pinned({ children }: { readonly children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 bg-bg pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

/** The column every screen of this module is drawn in. */
export function Column({ children }: { readonly children: ReactNode }) {
  return <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col gap-3 py-3">{children}</div>;
}
