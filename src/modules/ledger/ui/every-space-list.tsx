import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { MoneyDto, MyTransactionPageDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney } from "@/shared/ui/format/formatters";
import { groupByDay } from "./day-groups";
import { withTx } from "./detail/tx-href";
import { dateOf, entryOf } from "./home/feed";
import { FeedRow } from "./home/unified-home";
import { ListFilters } from "./list-filters";
import { hrefOf, myListQueryOf, type ListFilter, type ListSpace } from "./list-href";
import { useMyLoadMore } from "./load-more";
import { PendingBanner } from "./pending/pending-banner";
import { SavedNotice } from "./saved-notice";
import { DayCards, ListHeader, MoreFooter } from "./transaction-list";
import type { RowContext } from "./transaction-row";

/**
 * Ruling P319 (#294, board "Movimientos de Personal: todos tus espacios, tu parte y filtro de espacio"): the personal
 * Movimientos of someone with other spaces lists them all. The same search, period and filters, plus the space chip;
 * her part of the expenses and her income where the totals were; her own rows as the personal list draws them, opening
 * their sheet over it, and her spaces' as Inicio's Recientes does (P306), each with its space and her part.
 */
export function EverySpaceList({
  spaceId,
  page,
  context,
  today,
  filter,
  spaces,
  previous = null,
  next = null,
  periods,
  periodPolicy,
  notice,
  pendingCount = 0,
  pendingNames,
  api,
}: {
  /** The personal space, whose address, periods and recurring movements the list keeps. */
  readonly spaceId: string;
  readonly page: MyTransactionPageDto;
  /** How the personal space's own rows read (its categories and accounts). */
  readonly context: RowContext;
  readonly today: string;
  readonly filter: ListFilter;
  /** The person's current spaces, the personal one first. */
  readonly spaces: readonly ListSpace[];
  readonly previous?: PeriodDto | null;
  readonly next?: PeriodDto | null;
  readonly periods?: readonly PeriodDto[] | undefined;
  readonly periodPolicy?: SpaceDto["periodPolicy"] | undefined;
  /** A saved expense that left a shared fund negative (ruling P170). */
  readonly notice?: { readonly accountName: string; readonly balance: MoneyDto };
  readonly pendingCount?: number;
  readonly pendingNames?: readonly string[];
  /** For tests: the client "Cargar más" calls; the browser's own by default. */
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const listHref = hrefOf(spaceId, filter);
  const more = useMyLoadMore({ query: myListQueryOf(filter), cursor: page.nextCursor, api });
  const days = groupByDay([...page.items, ...more.rows].map(entryOf), today, dateOf);
  // The filters offer the categories and accounts of the spaces shown: every one, or the one chosen.
  const shown = spaces.filter((s) => filter.spaceId === undefined || s.id === filter.spaceId);
  const groups = shown.flatMap((s) => s.groups);
  const accounts = shown.flatMap((s) => s.accounts);
  const figure = (money: MoneyDto, positive: boolean) => (chunks: ReactNode) => (
    <strong className={positive && BigInt(money.amount) > 0n ? "font-semibold text-accent" : "font-semibold"}>
      {chunks}
    </strong>
  );
  return (
    <div className="flex flex-col gap-3 py-3">
      <ListHeader spaceId={spaceId} subtitle={t("list.everySpace")} />
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
        period={page.period}
        previous={previous}
        next={next}
        periods={periods}
        today={today}
        filter={filter}
        groups={groups}
        accounts={accounts}
        accountNames={Object.fromEntries(accounts.map((a) => [a.id, a.name]))}
        periodPolicy={periodPolicy}
        formats={context.formats}
        spaces={spaces}
      />
      <section aria-label={t("list.totals")} className="text-sm text-ink">
        {t.rich("list.share", {
          amount: formatMoney(page.totals.share, context.formats),
          b: figure(page.totals.share, false),
        })}{" "}
        ·{" "}
        {t.rich("list.income", {
          amount: formatSignedMoney(page.totals.income, context.formats),
          b: figure(page.totals.income, true),
        })}
      </section>
      <DayCards
        days={days}
        formats={context.formats}
        row={(entry) => (
          <FeedRow
            key={entry.kind === "own" ? entry.tx.id : entry.item.transaction.id}
            entry={entry}
            context={context}
            today={today}
            ownHref={(id) => withTx(listHref, id)}
            card
          />
        )}
      />
      <MoreFooter more={more} />
    </div>
  );
}
