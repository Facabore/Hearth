import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button, ProblemNotice } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDayMonthYear } from "@/shared/ui/format/day-month";
import type { Formats } from "@/shared/ui/format/formatters";
import type { DayGroup } from "./day-groups";

// Ruling P327: the day labels and "Cargar más" in a module of their own, so an account's screen draws them without
// loading Movimientos' list and its filters.

/**
 * Ruling P324 (board "Movimientos", densidad media, amending P284): each day headed by its date alone in a small muted
 * label, then its flat rows between hairline dividers, with no card; or the empty line. Ruling P327: the label reads
 * "Hoy", "Ayer", then the day and short month ("10 nov"), with the year only outside today's year ("10 nov 2025").
 */
export function DayList<T>({
  days,
  formats,
  today,
  row,
}: {
  readonly days: readonly DayGroup<T>[];
  readonly formats: Formats;
  /** The person's own date, which tells whether a day's label needs its year. */
  readonly today: string;
  /** One row of the day, with its key. */
  readonly row: (item: T) => ReactNode;
}) {
  const t = useTranslations("ledger");
  const common = useTranslations("common");
  if (days.length === 0) return <p className="text-muted">{t("list.empty")}</p>;
  return (
    <div className="flex flex-col">
      {days.map((day) => {
        return (
          <section
            key={day.date}
            aria-labelledby={`day-${day.date}`}
            className="flex flex-col border-b border-line last:border-b-0"
          >
            <h2 id={`day-${day.date}`} className="pt-3 text-[13px] font-semibold text-muted">
              {day.relative
                ? t(`day.${day.relative}`)
                : formatDayMonthYear(
                    day.date,
                    common(`monthShort.${Number(day.date.slice(5, 7)) as 1}`),
                    formats,
                    today,
                  )}
            </h2>
            <ol className="divide-y divide-line">{day.items.map(row)}</ol>
          </section>
        );
      })}
    </div>
  );
}

/** "Cargar más" while the API has a next page, and what went wrong with the last one. */
export function MoreFooter({
  more,
}: {
  readonly more: {
    readonly next: string | null;
    readonly problem: Problem | null;
    readonly pending: boolean;
    readonly more: () => Promise<void>;
  };
}) {
  const t = useTranslations("ledger");
  return (
    <>
      {more.problem ? <ProblemNotice problem={more.problem} /> : null}
      {more.next ? (
        <Button variant="secondary" disabled={more.pending} onClick={() => void more.more()}>
          {t("list.loadMore")}
        </Button>
      ) : null}
    </>
  );
}
