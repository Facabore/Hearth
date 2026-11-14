import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button, ProblemNotice } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import type { DayGroup } from "./day-groups";

// Ruling P327: the day labels and "Cargar más" in a module of their own, so an account's screen draws them without
// loading Movimientos' list and its filters.

/**
 * Ruling P324 (board "Movimientos", densidad media, amending P284): each day headed by its date alone in a small muted
 * label, then its flat rows between hairline dividers, with no card; or the empty line.
 */
export function DayList<T>({
  days,
  formats,
  row,
}: {
  readonly days: readonly DayGroup<T>[];
  readonly formats: Formats;
  /** One row of the day, with its key. */
  readonly row: (item: T) => ReactNode;
}) {
  const t = useTranslations("ledger");
  if (days.length === 0) return <p className="text-muted">{t("list.empty")}</p>;
  return (
    <div className="flex flex-col">
      {days.map((day) => {
        const date = formatDate(day.date, formats);
        return (
          <section
            key={day.date}
            aria-labelledby={`day-${day.date}`}
            className="flex flex-col border-b border-line last:border-b-0"
          >
            <h2 id={`day-${day.date}`} className="pt-3 text-[13px] font-semibold text-muted">
              {day.relative ? `${t(`day.${day.relative}`)} · ${date}` : date}
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
