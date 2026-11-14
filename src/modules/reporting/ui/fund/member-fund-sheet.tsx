"use client";

import { useTranslations } from "next-intl";
import { Sheet } from "@/shared/ui";
import type { FundTrackingDto, MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";

type FundRow = FundTrackingDto["members"][number];

const AMOUNT = "shrink-0 text-right text-base font-semibold tabular-nums [overflow-wrap:anywhere]";
const ROW = "flex items-start justify-between gap-3 border-b border-line py-3";

/**
 * P328, board "Por persona · detalle de Ana · #316": what a member has to put in for the period ("Le toca", the hero,
 * and their share of what the plan expects through the fund), one row per line they pay directly with what they paid
 * on it (D26), the rest that goes into the fund with what they put in, and what is left ("Le faltan") or "Al día".
 */
export function MemberFundSheet({
  open,
  onOpenChange,
  row,
  name,
  period,
  spaceName,
  total,
  formats,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly row: FundRow;
  /** "Ana (tú)". */
  readonly name: string;
  /** The period in a word ("noviembre"). */
  readonly period: string;
  readonly spaceName: string;
  /** What the plan expects through the fund from everyone (the report's totals). */
  readonly total: MoneyDto;
  readonly formats: Pick<Formats, "numberFormat">;
}) {
  const t = useTranslations("reports.fund.detail");
  const money = (minor: bigint) =>
    formatMoney({ amount: String(minor), currency: row.expected.currency }, formats);
  const expected = BigInt(row.expected.amount);
  const actual = BigInt(row.actual.amount);
  const all = BigInt(total.amount);
  const lines = row.paidDirectly ?? [];
  // What they paid directly is part of what they put in; the rest of their part goes through the fund.
  const direct = lines.reduce((sum, line) => sum + BigInt(line.amount.amount), 0n);
  const max = (a: bigint, b: bigint) => (a > b ? a : b);
  const throughFund = max(expected - direct, 0n);
  const intoFund = max(actual - direct, 0n);
  const left = BigInt(row.difference.amount) < 0n ? -BigInt(row.difference.amount) : 0n;
  // Whole percentages, rounded half up, as the board says them ("42 %").
  const percent = all > 0n ? (expected * 200n + all) / (all * 2n) : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title", { name, period })}>
      <div className="flex flex-col">
        <p className="text-sm text-muted">{t("share")}</p>
        <p className="text-4xl font-semibold tabular-nums [overflow-wrap:anywhere] text-ink">
          {money(expected)}
        </p>
        {percent === null ? null : (
          <p className="text-sm text-muted">
            {t("ofPlan", { percent: formatPercent(String(percent), formats), total: money(all) })}
          </p>
        )}
        <ul className="mt-3 flex flex-col">
          {lines.map((line) => (
            <li key={line.lineId} className={ROW}>
              <span className="flex min-w-0 flex-col">
                <span className="text-base [overflow-wrap:anywhere] text-ink">{line.name}</span>
                <span className="text-sm text-muted">
                  {t("paidLine", { state: BigInt(line.amount.amount) > 0n ? "paid" : "pending" })}
                </span>
              </span>
              <span className={AMOUNT}>{money(BigInt(line.amount.amount))}</span>
            </li>
          ))}
          <li className={ROW}>
            <span className="flex min-w-0 flex-col">
              <span className="text-base [overflow-wrap:anywhere] text-ink">
                {t("toFund", { space: spaceName })}
              </span>
              <span className="text-sm text-muted">
                {t("toFundNote", { actual: money(intoFund), expected: money(throughFund) })}
              </span>
            </span>
            <span className={AMOUNT}>{money(throughFund)}</span>
          </li>
          {/* "Le faltan" says the direction in words, so the amount carries no sign; color is never the only signal. */}
          <li className="flex items-center justify-between gap-3 py-3">
            <span className="text-base font-semibold text-ink">{left > 0n ? t("left") : t("settled")}</span>
            {left > 0n ? <span className={`${AMOUNT} text-owe-ink`}>{money(left)}</span> : null}
          </li>
        </ul>
      </div>
    </Sheet>
  );
}
