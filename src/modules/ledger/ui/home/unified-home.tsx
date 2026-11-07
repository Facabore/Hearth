import { useTranslations } from "next-intl";
import { MASKED_AMOUNT, shownAmount, useAmountsHidden } from "@/modules/spaces/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
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
  personId,
}: {
  readonly feed: readonly FeedEntry[];
  readonly spaceId: string;
  readonly context: RowContext;
  readonly today: string;
  /** Ruling P278: Inicio's eye hides every amount. */
  readonly personId: string;
}) {
  const t = useTranslations("home");
  const hidden = useAmountsHidden(personId);
  const money = (amount: MoneyDto) => shownAmount(amount, hidden, context.formats);
  const masked = hidden ? MASKED_AMOUNT : undefined;
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
            maskedAmount={masked}
          />
        ) : (
          <ActivityRow
            key={entry.item.transaction.id}
            item={entry.item}
            formats={context.formats}
            viewerZone={context.viewerZone}
            today={today}
            money={money}
            maskedAmount={masked}
          />
        ),
      )}
    </ol>
  );
}
