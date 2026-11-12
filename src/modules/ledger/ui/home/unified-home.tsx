import { useTranslations } from "next-intl";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney } from "@/shared/ui/format/formatters";
import { withTx } from "../detail/tx-href";
import { TransactionRow, type RowContext } from "../transaction-row";
import { ActivityRow } from "./activity-row";
import type { FeedEntry } from "./feed";

/**
 * Ruling P306: one row of the person's merged movements. Her own as her personal space draws them, opening `ownHref`;
 * her spaces' with their space, who recorded them and her part, opening the movement in its space. Ruling P319: the
 * personal Movimientos draws them in its day cards (`card`), where her own rows are today's list rows.
 */
export function FeedRow({
  entry,
  context,
  today,
  ownHref,
  card = false,
}: {
  readonly entry: FeedEntry;
  readonly context: RowContext;
  readonly today: string;
  /** Where one of her own rows opens its detail. */
  readonly ownHref: (id: string) => string;
  readonly card?: boolean;
}) {
  const money = (amount: MoneyDto) => formatMoney(amount, context.formats);
  return entry.kind === "own" ? (
    <TransactionRow
      tx={entry.tx}
      context={context}
      href={ownHref(entry.tx.id)}
      {...(card ? { card } : { today })}
    />
  ) : (
    <ActivityRow
      item={entry.item}
      formats={context.formats}
      viewerZone={context.viewerZone}
      today={today}
      money={money}
      card={card}
    />
  );
}

/**
 * Ruling P306: Recientes on the personal home of someone with other spaces, her own rows as Inicio always drew them and
 * her spaces' with their space, who recorded them and her part, in one list.
 */
export function UnifiedRecent({
  feed,
  spaceId,
  context,
  today,
}: {
  readonly feed: readonly FeedEntry[];
  readonly spaceId: string;
  readonly context: RowContext;
  readonly today: string;
}) {
  const t = useTranslations("home");
  if (feed.length === 0)
    return <p className="rounded-2xl bg-surface p-3 text-sm text-muted">{t("recentEmpty")}</p>;
  return (
    <ol className="divide-y divide-line">
      {feed.map((entry) => (
        <FeedRow
          key={entry.kind === "own" ? entry.tx.id : entry.item.transaction.id}
          entry={entry}
          context={context}
          today={today}
          ownHref={(id) => withTx(`/spaces/${spaceId}`, id)}
        />
      ))}
    </ol>
  );
}
