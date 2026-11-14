import { useTranslations } from "next-intl";
import { findCategory } from "@/modules/categories/ui";
import type { Api } from "@/shared/ui/api/client";
import type {
  ActivityItemDto,
  MyTransactionPageDto,
  TransactionDto,
  TransactionPageDto,
} from "@/shared/ui/api/dto";
import { formatMoney } from "@/shared/ui/format/formatters";
import { movedBy, type AccountView } from "./account-direction";
import { groupByDay } from "./day-groups";
import { withTx } from "./detail/tx-href";
import { ActivityRow } from "./home/activity-row";
import { dateOf, entryOf, type FeedEntry } from "./home/feed";
import { listQueryOf, myListQueryOf } from "./list-href";
import { useLoadMore, useMyLoadMore } from "./load-more";
import { DayList, MoreFooter } from "./day-list";
import { TransactionRow, type RowContext } from "./transaction-row";

interface Common {
  readonly context: RowContext;
  readonly today: string;
  readonly account: AccountView;
  /** The account's screen as shown, which a row of the space's own opens its detail over (P189). */
  readonly href: string;
  /** For tests: the client "Cargar más" calls; the browser's own by default. */
  readonly api?: Api;
}

/**
 * Ruling P327: the period's rows under their day labels, each opening as Movimientos opens it, then "Cargar más". Each
 * amount is what the account moved, signed by direction; a row of the space's own names the kind of movement and its
 * category ("Ingreso · Trabajo", "pagó el fondo · Mercado", "Transferencia entre tus cuentas"), and a row of another
 * space of the person names her part ("Hogar · tu parte $ 32.000").
 */
function AccountDays({
  entries,
  more,
  context,
  today,
  account,
  href,
}: Common & {
  readonly entries: readonly FeedEntry[];
  readonly more: Parameters<typeof MoreFooter>[0]["more"];
}) {
  const t = useTranslations("ledger");
  const { accountNames, memberNames, groups, formats } = context;
  const name = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (id ? (memberNames[id] ?? "") : "");
  const lineOf = (tx: TransactionDto): string[] => {
    if (tx.type === "TRANSFER") {
      // A contribution names where it came from: the viewer's own account, else the member who paid it in.
      const own = tx.sourceAccountId ? (account.ownAccountNames?.[tx.sourceAccountId] ?? "") : "";
      return [
        tx.payerMemberId === null
          ? t("betweenYourAccounts")
          : t("transfer", {
              from: name(tx.sourceAccountId) || own || member(tx.payerMemberId),
              to: name(tx.destinationAccountId),
            }),
      ];
    }
    if (tx.type === "SETTLEMENT")
      return [t("settlement", { from: member(tx.payerMemberId), to: member(tx.receivingMemberId) })];
    const category = tx.categoryId ? findCategory(groups, tx.categoryId)?.category.name : undefined;
    const kind = tx.type === "INCOME" ? t("type.INCOME") : account.fund ? t("paidByFund") : undefined;
    return [kind, category].filter((part): part is string => Boolean(part));
  };
  const detailOf = (item: ActivityItemDto): string | undefined =>
    item.transaction.type === "EXPENSE" && item.you.share
      ? t("yourShare", { share: formatMoney(item.you.share, formats) })
      : undefined;
  return (
    <>
      <DayList
        days={groupByDay(entries, today, dateOf)}
        formats={formats}
        row={(entry) =>
          entry.kind === "own" ? (
            <TransactionRow
              key={entry.tx.id}
              tx={entry.tx}
              context={context}
              href={withTx(href, entry.tx.id)}
              card
              moved={{ ...movedBy(entry.tx, account.id), line: lineOf(entry.tx) }}
            />
          ) : (
            <ActivityRow
              key={entry.item.transaction.id}
              item={entry.item}
              formats={formats}
              viewerZone={context.viewerZone}
              today={today}
              money={(amount) => formatMoney(amount, formats)}
              card
              moved={{ ...movedBy(entry.item.transaction, account.id), detail: detailOf(entry.item) }}
            />
          )
        }
      />
      <MoreFooter more={more} />
    </>
  );
}

/**
 * Ruling P327 (board "Fondo de Hogar · Movimientos · #315"): what a shared fund paid, received or moved in the period,
 * the space's movements with that account (P277).
 */
export function FundMovements({
  spaceId,
  period,
  page,
  ...common
}: Common & { readonly spaceId: string; readonly period: string; readonly page: TransactionPageDto }) {
  const more = useLoadMore({
    spaceId,
    query: listQueryOf({ period, accountId: common.account.id }),
    cursor: page.nextCursor,
    api: common.api,
  });
  const entries = [...page.items, ...more.rows].map((tx): FeedEntry => ({ kind: "own", tx }));
  return <AccountDays entries={entries} more={more} {...common} />;
}

/**
 * Ruling P327 (board "Cuenta · Movimientos · #315"): what one of the person's accounts paid, received or moved in the
 * period across every space of hers (P319): a Hogar expense it paid reads "Hogar · tu parte $ 32.000".
 */
export function PersonalAccountMovements({
  period,
  page,
  ...common
}: Common & { readonly period: string; readonly page: MyTransactionPageDto }) {
  const more = useMyLoadMore({
    query: myListQueryOf({ period, accountId: common.account.id }),
    cursor: page.nextCursor,
    api: common.api,
  });
  const entries = [...page.items, ...more.rows].map(entryOf);
  return <AccountDays entries={entries} more={more} {...common} />;
}
