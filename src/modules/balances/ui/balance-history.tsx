import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, ScreenHeader, VisuallyHidden } from "@/shared/ui";
import type { BalanceHistoryDto, MemberDto, MoneyDto, PeriodDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";

const INK = { owes: "text-owe", owed: "text-accent", settled: "text-ink" } as const;

type Entry = BalanceHistoryDto["entries"][number];

/**
 * Ruling P322 (board B7): a gift is two settlements, the payment made for the member and the GIFT that clears what they
 * owed its payer back. In the member's own history they read as one row: each GIFT the member received takes its linked
 * payment (`linkedTransactionId`), or, from an API without the link, the payment of the same day that its giver made for
 * them; that payment's row is left out.
 */
const giftPairs = (entries: readonly Entry[], memberId: string): Map<string, Entry> => {
  const pairs = new Map<string, Entry>();
  const taken = new Set<string>();
  entries.forEach((gift, at) => {
    if (gift.settlementReason !== "GIFT" || gift.payerMemberId !== memberId) return;
    const linked = gift.linkedTransactionId
      ? entries.find((entry) => entry.transactionId === gift.linkedTransactionId)
      : undefined;
    if (linked) {
      taken.add(linked.transactionId);
      pairs.set(gift.transactionId, linked);
      return;
    }
    const candidates = entries
      .map((entry, index) => ({ entry, distance: Math.abs(index - at) }))
      .filter(
        ({ entry }) =>
          !taken.has(entry.transactionId) &&
          entry.settlementReason !== "GIFT" &&
          entry.onBehalfOfMemberId === memberId &&
          entry.payerMemberId === gift.receivingMemberId &&
          entry.date === gift.date &&
          BigInt(entry.change.amount) === 0n,
      )
      .sort((a, b) => a.distance - b.distance);
    const payment = candidates[0]?.entry;
    if (!payment) return;
    taken.add(payment.transactionId);
    pairs.set(gift.transactionId, payment);
  });
  return pairs;
};

/**
 * HU-E9-07, the BalanceHistory artboard as `/spaces/{spaceId}/members/{memberId}/history` (ruling P176): the member's
 * net at the start and at the end of a period of the space, and each movement that changed it as the running balance
 * after it (a sentence, ruling P173) over how much it changed it. The API's entries carry no payer or amount, so an
 * entry is titled by its description or the name of its type, not by the artboard's "Ana pagó $ 300.000", and has no
 * split line under it.
 *
 * Ruling P272 (board 04): the period is a chip, each summary is a neutral amount followed by its state in words, and
 * each entry has a date column. The board has no row to what the member paid (issue #148), so it is gone; Movimientos'
 * payer filter still answers that.
 *
 * Ruling P322 (boards B6 and B7): a settlement says who paid for whom, speaking to the history's member: a payment made
 * for them reads "Kamilox pagó por ti", lent to them (its change is 0: the debt only moved to the payer) or given, and a
 * forgiven debt says so. The names come from `members`; one that is not a current member leaves the plain title.
 */
export function BalanceHistory({
  spaceId,
  spaceName,
  member,
  members = [],
  period,
  previous,
  next,
  history,
  formats,
}: {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly member: MemberDto;
  /** The space's current members, guests included: whose names a settlement's row says. */
  readonly members?: readonly MemberDto[];
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly history: BalanceHistoryDto;
  readonly formats: Formats;
}) {
  const t = useTranslations("balances");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const hrefOf = (target: PeriodDto) =>
    `/spaces/${spaceId}/members/${member.id}/history?from=${target.startDate}`;
  const step = "flex size-11 items-center justify-center rounded-xl text-ink";
  // A positive change reads "+$ 50.000"; a negative one is written by `formatMoney` with the typographic minus.
  const changeOf = (change: MoneyDto) =>
    `${BigInt(change.amount) > 0n ? "+" : ""}${formatMoney(change, formats)}`;
  const nameOf = (id: string | null | undefined) => members.find((one) => one.id === id)?.displayName ?? "";
  const pairs = giftPairs(history.entries, member.id);
  const paired = new Set([...pairs.values()].map((payment) => payment.transactionId));
  const entries = history.entries.filter((entry) => !paired.has(entry.transactionId));
  /** P322: a settlement's title and the line under it, or its description (else its type) when it says no more. */
  const linesOf = (entry: Entry): { title: string; detail: string | null } => {
    const plain = { title: entry.description || tLedger(`type.${entry.type}`), detail: null };
    const payer = nameOf(entry.payerMemberId);
    const receiver = nameOf(entry.receivingMemberId);
    if (entry.type !== "SETTLEMENT" || !payer || !receiver) return plain;
    const mine = (id: string | null | undefined) => id === member.id;
    if (entry.settlementReason === "FORGIVENESS")
      return {
        title: tLedger("type.FORGIVENESS"),
        detail: mine(entry.payerMemberId)
          ? t("history.forgivenBy", { receiver })
          : mine(entry.receivingMemberId)
            ? t("history.forgaveTo", { payer })
            : null,
      };
    if (entry.settlementReason === "GIFT") {
      if (!mine(entry.payerMemberId))
        return { title: tLedger("detail.gaveFor", { name: payer }), detail: null };
      const paidTo = nameOf(pairs.get(entry.transactionId)?.receivingMemberId);
      return {
        title: t("history.paidForYou", { payer: receiver }),
        detail: paidTo ? t("history.gave", { receiver: paidTo }) : t("history.gaveBare"),
      };
    }
    const behalf = nameOf(entry.onBehalfOfMemberId);
    if (!behalf) return plain;
    if (mine(entry.onBehalfOfMemberId))
      return { title: t("history.paidForYou", { payer }), detail: t("history.lent", { receiver }) };
    return {
      title: tLedger("detail.paidFor", { name: behalf }),
      detail: mine(entry.payerMemberId) ? t("history.to", { receiver }) : null,
    };
  };

  return (
    <div className="flex flex-col gap-3 pb-3">
      <ScreenHeader
        backHref={`/spaces/${spaceId}/balances`}
        title={t("history.title", { name: member.displayName })}
        subtitle={spaceName}
      />
      {/* Board 04: the period is a chip with a calendar icon. Its neighbours stay a tap away beside it (P176). */}
      <div className="flex items-center justify-between gap-2">
        <p
          data-period-chip
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl bg-track px-3.5 font-medium tabular-nums text-ink"
        >
          <Icon name="calendar" size={18} className="shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {t("history.range", {
              start: formatDate(period.startDate, formats),
              end: formatDate(period.endDate, formats),
            })}
          </span>
        </p>
        <span className="flex shrink-0">
          {previous ? (
            <Link href={hrefOf(previous)} className={step}>
              <Icon name="back" />
              <VisuallyHidden>{t("history.previous")}</VisuallyHidden>
            </Link>
          ) : null}
          {next ? (
            <Link href={hrefOf(next)} className={step}>
              <Icon name="chevronRight" />
              <VisuallyHidden>{t("history.next")}</VisuallyHidden>
            </Link>
          ) : null}
        </span>
      </div>
      <section aria-label={t("history.summary")} className="grid grid-cols-2 gap-2.5">
        {(["opening", "closing"] as const).map((key) => {
          const state = netState(history[key]);
          // Board 04: a large neutral amount, then its state in words; a start at zero is the bare amount.
          const word = key === "opening" && state === "settled" ? null : state;
          return (
            <div
              key={key}
              className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-surface px-3.5 py-3"
            >
              <span className="text-[13px] text-muted">{t(`history.${key}`)}</span>
              <span className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[22px] leading-tight font-semibold tabular-nums text-ink [overflow-wrap:anywhere]">
                  {formatMoney(absolute(history[key]), formats)}
                </span>
                {word ? (
                  <span className={`text-sm font-medium ${INK[word]}`}>{t(`history.state.${word}`)}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </section>
      <section aria-labelledby="balance-history-entries" className="flex flex-col gap-1.5">
        <h2 id="balance-history-entries" className="px-0.5 text-sm font-semibold text-muted">
          {t("history.entries")}
        </h2>
        {entries.length === 0 ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("history.empty")}</p>
        ) : (
          <>
            <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {entries.map((entry) => {
                const { title, detail } = linesOf(entry);
                return (
                  <li key={entry.transactionId} className="flex min-h-row-lg items-center gap-3 px-3 py-2">
                    {/* Board 04: a date column, the day over the short month. */}
                    <span className="flex w-9 shrink-0 flex-col items-center tabular-nums">
                      <span className="text-lg leading-tight font-semibold text-ink">
                        {Number(entry.date.slice(8, 10))}
                      </span>
                      <span className="text-xs text-muted">
                        {tCommon(`monthShort.${Number(entry.date.slice(5, 7)) as 1}`)}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="text-[15px] font-medium text-ink">{title}</span>
                      {detail ? <span className="text-[13px] text-muted">{detail}</span> : null}
                    </span>
                    <span className="flex max-w-[55%] shrink-0 flex-col items-end gap-0.5 text-right tabular-nums [overflow-wrap:anywhere]">
                      <span className={`text-[15px] font-semibold ${INK[netState(entry.balance)]}`}>
                        {memberSentence(entry.balance, formats, t)}
                      </span>
                      <span className="text-[13px] text-muted">{changeOf(entry.change)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-[13px] text-muted">{t("history.note")}</p>
          </>
        )}
      </section>
    </div>
  );
}
