import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, ScreenHeader, VisuallyHidden } from "@/shared/ui";
import type { BalanceHistoryDto, MemberDto, MoneyDto, PeriodDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { memberSentence, netState } from "./net-state";

const INK = { owes: "text-owe", owed: "text-accent", settled: "text-ink" } as const;

/**
 * HU-E9-07, the BalanceHistory artboard as `/spaces/{spaceId}/members/{memberId}/history` (ruling P176): the member's
 * net at the start and at the end of a period of the space, and each movement that changed it as the running balance
 * after it (a sentence, ruling P173) over how much it changed it. The API's entries carry no payer or amount, so an
 * entry is titled by its description or the name of its type, not by the artboard's "Ana pagó $ 300.000".
 */
export function BalanceHistory({
  spaceId,
  spaceName,
  member,
  period,
  previous,
  next,
  history,
  formats,
}: {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly member: MemberDto;
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly history: BalanceHistoryDto;
  readonly formats: Formats;
}) {
  const t = useTranslations("balances");
  const tLedger = useTranslations("ledger");
  const hrefOf = (target: PeriodDto) =>
    `/spaces/${spaceId}/members/${member.id}/history?from=${target.startDate}`;
  const step = "flex size-11 items-center justify-center rounded-xl text-ink";
  // A positive change reads "+$ 50.000"; a negative one is written by `formatMoney` with the typographic minus.
  const changeOf = (change: MoneyDto) =>
    `${BigInt(change.amount) > 0n ? "+" : ""}${formatMoney(change, formats)}`;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <ScreenHeader
        backHref={`/spaces/${spaceId}/balances`}
        title={t("history.title", { name: member.displayName })}
        subtitle={spaceName}
      />
      <div className="flex items-center justify-between">
        {previous ? (
          <Link href={hrefOf(previous)} className={step}>
            <Icon name="back" />
            <VisuallyHidden>{t("history.previous")}</VisuallyHidden>
          </Link>
        ) : (
          <span className="size-11" />
        )}
        <p className="font-medium tabular-nums text-ink">
          {t("history.range", {
            start: formatDate(period.startDate, formats),
            end: formatDate(period.endDate, formats),
          })}
        </p>
        {next ? (
          <Link href={hrefOf(next)} className={step}>
            <Icon name="chevronRight" />
            <VisuallyHidden>{t("history.next")}</VisuallyHidden>
          </Link>
        ) : (
          <span className="size-11" />
        )}
      </div>
      <section aria-label={t("history.summary")} className="grid grid-cols-2 gap-2.5">
        {(["opening", "closing"] as const).map((key) => (
          <div
            key={key}
            className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-line bg-surface px-3.5 py-3"
          >
            <span className="text-[13px] text-muted">{t(`history.${key}`)}</span>
            <span
              className={`text-base font-semibold tabular-nums [overflow-wrap:anywhere] ${INK[netState(history[key])]}`}
            >
              {memberSentence(history[key], formats, t)}
            </span>
          </div>
        ))}
      </section>
      <section aria-labelledby="balance-history-entries" className="flex flex-col gap-1.5">
        <h2 id="balance-history-entries" className="px-0.5 text-sm font-semibold text-muted">
          {t("history.entries")}
        </h2>
        {history.entries.length === 0 ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("history.empty")}</p>
        ) : (
          <>
            <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {history.entries.map((entry) => (
                <li key={entry.transactionId} className="flex min-h-[76px] items-center gap-3 px-3.5 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13px] tabular-nums text-muted">
                      {formatDate(entry.date, formats)}
                    </span>
                    <span className="text-[15px] font-medium text-ink [overflow-wrap:anywhere]">
                      {entry.description || tLedger(`type.${entry.type}`)}
                    </span>
                  </span>
                  <span className="flex max-w-[55%] shrink-0 flex-col items-end gap-0.5 text-right tabular-nums [overflow-wrap:anywhere]">
                    <span className={`text-[15px] font-semibold ${INK[netState(entry.balance)]}`}>
                      {memberSentence(entry.balance, formats, t)}
                    </span>
                    <span className="text-[13px] text-muted">{changeOf(entry.change)}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-muted">{t("history.note")}</p>
          </>
        )}
      </section>
    </div>
  );
}
