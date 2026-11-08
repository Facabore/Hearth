import { useTranslations } from "next-intl";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney } from "@/shared/ui/format/formatters";
import { withTx } from "../detail/tx-href";
import { TransactionRow, type RowContext } from "../transaction-row";
import { ActivityRow } from "./activity-row";
import type { FeedEntry } from "./feed";

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
  const money = (amount: MoneyDto) => formatMoney(amount, context.formats);
  if (feed.length === 0)
    return <p className="rounded-2xl bg-surface p-3 text-sm text-muted">{t("recentEmpty")}</p>;
  return (
    <ol className="divide-y divide-line">
      {feed.map((entry) =>
        entry.kind === "own" ? (
          <TransactionRow
            key={entry.tx.id}
            tx={entry.tx}
            context={context}
            href={withTx(`/spaces/${spaceId}`, entry.tx.id)}
            today={today}
          />
        ) : (
          <ActivityRow
            key={entry.item.transaction.id}
            item={entry.item}
            formats={context.formats}
            viewerZone={context.viewerZone}
            today={today}
            money={money}
          />
        ),
      )}
    </ol>
  );
}
