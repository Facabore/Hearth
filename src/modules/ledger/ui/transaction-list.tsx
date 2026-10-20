import { useTranslations } from "next-intl";
import type { PeriodDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney } from "@/shared/ui/format/formatters";
import { groupByDay } from "./day-groups";
import { ListFilters, type ListFilter } from "./list-filters";
import { LoadMore } from "./load-more";
import { TransactionRow, type RowContext } from "./transaction-row";

/** HU-E9-03, the Activity artboard: the period's rows by day with the API's totals; no per-day totals (P130). */
export function TransactionList({
  spaceId,
  page,
  context,
  today,
  filter,
  previous = null,
  next = null,
}: {
  readonly spaceId: string;
  readonly page: TransactionPageDto;
  readonly context: RowContext;
  readonly today: string;
  readonly filter: ListFilter;
  readonly previous?: PeriodDto | null;
  readonly next?: PeriodDto | null;
}) {
  const t = useTranslations("ledger");
  const days = groupByDay(page.items, today);
  return (
    <div className="flex flex-col gap-5 py-4">
      <h1 className="text-2xl font-semibold text-ink">{t("list.title")}</h1>
      <ListFilters
        spaceId={spaceId}
        period={page.period}
        previous={previous}
        next={next}
        filter={filter}
        groups={context.groups}
      />
      <section aria-label={t("list.totals")} className="rounded-2xl bg-surface p-4 text-ink">
        {t("list.expenses", { amount: formatMoney(page.totals.expenses, context.formats) })} ·{" "}
        {t("list.income", { amount: formatMoney(page.totals.income, context.formats) })}
      </section>
      {days.length === 0 ? <p className="text-muted">{t("list.empty")}</p> : null}
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`day-${day.date}`}>
          <h2 id={`day-${day.date}`} className="mb-1 text-sm font-semibold text-muted">
            {day.relative ? t(`day.${day.relative}`) : formatDate(day.date, context.formats)}
          </h2>
          <ol className="divide-y divide-line rounded-2xl bg-surface px-4">
            {day.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} context={context} />
            ))}
          </ol>
        </section>
      ))}
      {page.nextCursor ? (
        <LoadMore
          spaceId={spaceId}
          query={{ period: page.period.label, categoryIds: filter.categoryId }}
          cursor={page.nextCursor}
          lastDate={days.at(-1)?.date ?? ""}
          today={today}
          context={context}
        />
      ) : null}
    </div>
  );
}
