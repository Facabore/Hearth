import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button, ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, MoneyDto, PeriodDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDate, formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";
import { groupByDay, type DayGroup } from "./day-groups";
import type { TransactionDetail } from "./detail/transaction-detail";
import { TransactionSheetHost } from "./detail/transaction-sheet-host";
import { withTx } from "./detail/tx-href";
import { ListFilters } from "./list-filters";
import { hrefOf, listQueryOf, type ListFilter } from "./list-href";
import { useLoadMore } from "./load-more";
import { PendingBanner } from "./pending/pending-banner";
import { SavedNotice } from "./saved-notice";
import { TransactionRow, type RowContext } from "./transaction-row";

/**
 * HU-E9-03, board B1 06 "Movimientos por día y hora" (ruling P277): the period and the API's totals on one summary
 * line beside the search and the filters, then the period's rows by day. Ruling P324 (#309, densidad media): the
 * filters wait behind one Filtros button, and each day is a small label over flat rows with hairline dividers.
 */
export function TransactionList({
  spaceId,
  page,
  context,
  today,
  filter,
  previous = null,
  next = null,
  periods,
  accounts = [],
  notice,
  spaceName,
  periodPolicy,
  detail,
  movedMemberIds,
  pendingCount = 0,
  pendingNames,
  api,
}: {
  readonly spaceId: string;
  readonly page: TransactionPageDto;
  readonly context: RowContext;
  readonly today: string;
  readonly filter: ListFilter;
  readonly previous?: PeriodDto | null;
  readonly next?: PeriodDto | null;
  /** Ruling P277: the space's recent periods, for the period chip's sheet; its neighbours stand in until they are read. */
  readonly periods?: readonly PeriodDto[] | undefined;
  /** Ruling P277: the space's accounts, for the account filter. */
  readonly accounts?: readonly AccountDto[];
  /** A saved expense that left a shared fund negative (ruling P170). */
  readonly notice?: { readonly accountName: string; readonly balance: MoneyDto };
  /** #287: the name of a shared or direct space, which its totals carry; a personal space has none. */
  readonly spaceName?: string | undefined;
  /** Issue #178: the space's period policy, so the period reads as the Plan names it. */
  readonly periodPolicy?: SpaceDto["periodPolicy"] | undefined;
  /** Ruling P189: the transaction behind `?tx=`, shown in a sheet over the list. */
  readonly detail?: TransactionDetail | undefined;
  /** #217 (P263): the members any movement ever touched, from the balances; without it every member is offered. */
  readonly movedMemberIds?: readonly string[] | undefined;
  /** HU-E9-09 (ruling P270): the space's pending occurrences, for a member who records money; the banner shows above 0. */
  readonly pendingCount?: number;
  /** What waits, by name, for the banner's second line. */
  readonly pendingNames?: readonly string[];
  /** For tests: the client "Cargar más" calls; the browser's own by default. */
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const listHref = hrefOf(spaceId, filter);
  const more = useLoadMore({ spaceId, query: listQueryOf(filter), cursor: page.nextCursor, api });
  const days = groupByDay([...page.items, ...more.rows], today);
  const figure = (money: MoneyDto, positive: boolean) => (chunks: ReactNode) => (
    <strong className={positive && BigInt(money.amount) > 0n ? "font-semibold text-accent" : "font-semibold"}>
      {chunks}
    </strong>
  );
  return (
    <div className="flex flex-col gap-3 py-3">
      {/* Ruling P324: the shell's space pill names the space; the page keeps its heading for whoever reads it aloud. */}
      <h1 className="sr-only">{t("list.title")}</h1>
      {pendingCount > 0 ? (
        <PendingBanner spaceId={spaceId} count={pendingCount} names={pendingNames} />
      ) : null}
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
        summary={
          <section aria-label={t("list.totals")} className="inline">
            {/* #287 (audit pass 3, A6): a shared space's totals are the whole space's, so they name it. */}
            {t.rich(spaceName ? "list.expensesOf" : "list.expenses", {
              space: spaceName ?? "",
              amount: formatMoney(page.totals.expenses, context.formats),
              b: figure(page.totals.expenses, false),
            })}{" "}
            ·{" "}
            {t.rich("list.income", {
              amount: formatSignedMoney(page.totals.income, context.formats),
              b: figure(page.totals.income, true),
            })}
          </section>
        }
        period={page.period}
        previous={previous}
        next={next}
        periods={periods}
        today={today}
        filter={filter}
        groups={context.groups}
        accounts={accounts}
        accountNames={context.accountNames}
        periodPolicy={periodPolicy}
        formats={context.formats}
        memberNames={context.memberNames}
        movedMemberIds={movedMemberIds}
      />
      <DayList
        days={days}
        formats={context.formats}
        row={(tx) => (
          <TransactionRow key={tx.id} tx={tx} context={context} href={withTx(listHref, tx.id)} card />
        )}
      />
      <MoreFooter more={more} />
      {/* The origin is the list without `tx`: closing never re-shows a dismissed notice. */}
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={listHref} />
      ) : null}
    </div>
  );
}

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
