import { useTranslations } from "next-intl";
import type { MoneyDto, PeriodDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney } from "@/shared/ui/format/formatters";
import { groupByDay } from "./day-groups";
import type { TransactionDetail } from "./detail/transaction-detail";
import { TransactionSheetHost } from "./detail/transaction-sheet-host";
import { withTx } from "./detail/tx-href";
import { ListFilters } from "./list-filters";
import { hrefOf, type ListFilter } from "./list-href";
import { LoadMore } from "./load-more";
import { SavedNotice } from "./saved-notice";
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
  notice,
  spaceName,
  periodPolicy,
  detail,
}: {
  readonly spaceId: string;
  readonly page: TransactionPageDto;
  readonly context: RowContext;
  readonly today: string;
  readonly filter: ListFilter;
  readonly previous?: PeriodDto | null;
  readonly next?: PeriodDto | null;
  /** A saved expense that left a shared fund negative (ruling P170). */
  readonly notice?: { readonly accountName: string; readonly balance: MoneyDto };
  /** U7: the name of a shared or direct space, under the title; a personal space shows none. */
  readonly spaceName?: string | undefined;
  /** Issue #178: the space's period policy, so the period reads as the Plan names it. */
  readonly periodPolicy?: SpaceDto["periodPolicy"] | undefined;
  /** Ruling P189: the transaction behind `?tx=`, shown in a sheet over the list. */
  readonly detail?: TransactionDetail | undefined;
}) {
  const t = useTranslations("ledger");
  const days = groupByDay(page.items, today);
  const listHref = hrefOf(spaceId, filter);
  return (
    <div className="flex flex-col gap-3 py-3">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-[17px] leading-tight font-semibold text-ink">{t("list.title")}</h1>
        {spaceName ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{spaceName}</p> : null}
      </header>
      {notice ? (
        <SavedNotice
          accountName={notice.accountName}
          balance={notice.balance}
          formats={context.formats}
          dismissHref={listHref}
        />
      ) : null}
      <ListFilters
        spaceId={spaceId}
        period={page.period}
        previous={previous}
        next={next}
        filter={filter}
        groups={context.groups}
        periodPolicy={periodPolicy}
        formats={context.formats}
        memberNames={context.memberNames}
      />
      <section aria-label={t("list.totals")} className="rounded-2xl bg-surface p-3 text-ink">
        {t("list.expenses", { amount: formatMoney(page.totals.expenses, context.formats) })} ·{" "}
        {t("list.income", { amount: formatMoney(page.totals.income, context.formats) })}
      </section>
      {days.length === 0 ? <p className="text-muted">{t("list.empty")}</p> : null}
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`day-${day.date}`}>
          <h2 id={`day-${day.date}`} className="mb-1 text-sm font-semibold text-muted">
            {day.relative ? t(`day.${day.relative}`) : formatDate(day.date, context.formats)}
          </h2>
          <ol className="divide-y divide-line rounded-2xl bg-surface px-3">
            {day.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} context={context} href={withTx(listHref, tx.id)} />
            ))}
          </ol>
        </section>
      ))}
      {page.nextCursor ? (
        <LoadMore
          spaceId={spaceId}
          query={{
            period: page.period.label,
            categoryIds: filter.categoryId,
            payerMemberId: filter.payerMemberId,
          }}
          cursor={page.nextCursor}
          lastDate={days.at(-1)?.date ?? ""}
          today={today}
          context={context}
          listHref={listHref}
        />
      ) : null}
      {/* The origin is the list without `tx`: closing never re-shows a dismissed notice. */}
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={listHref} />
      ) : null}
    </div>
  );
}
