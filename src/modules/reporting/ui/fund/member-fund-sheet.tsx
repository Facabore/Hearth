"use client";

import { useTranslations } from "next-intl";
import { Sheet } from "@/shared/ui";
import type { FundTrackingDto, MoneyDto } from "@/shared/ui/api/dto";
import { Amount, AMOUNT_ROW, AMOUNT_ROW_AMOUNT, AMOUNT_ROW_LABEL } from "@/shared/ui/atoms/amount";
import { HeroAmount } from "@/shared/ui/atoms/hero-amount";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";

type FundRow = FundTrackingDto["members"][number];

// P335: a row's words wrap beside its amount, and the amount moves whole under them when they do not fit.
const AMOUNT = `${AMOUNT_ROW_AMOUNT} text-base font-semibold`;
const ROW = `${AMOUNT_ROW} items-start border-b border-line py-3`;
const LABEL = `${AMOUNT_ROW_LABEL} flex flex-col`;

/**
 * P328, board "Por persona · detalle de Ana · #316": what a member has to put in for the period ("Le toca", the hero,
 * and their share of what the fund pays: the lines paid with it, not the whole plan), one row per line they pay
 * directly with what they paid on it (D26), the rest that goes into the fund with what they put in, and what is left
 * ("Le faltan") or "Al día".
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
  /** What the plan expects through the fund from everyone (the report's totals): the lines it pays, not the plan. */
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
        {/* P335: one line at any width, font or number of digits; the figure scales with the sheet's width. */}
        <HeroAmount
          amount={money(expected)}
          size="2.25rem"
          className="leading-[1.1] font-semibold text-ink"
        />
        {percent === null ? null : (
          <p className="text-sm text-muted">
            {t("ofFund", { percent: formatPercent(String(percent), formats), total: money(all) })}
          </p>
        )}
        <ul className="mt-3 flex flex-col">
          {lines.map((line) => (
            <li key={line.lineId} className={ROW}>
              <span className={LABEL}>
                <span className="text-base [overflow-wrap:anywhere] text-ink">{line.name}</span>
                <span className="text-sm text-muted">
                  {t("paidLine", { state: BigInt(line.amount.amount) > 0n ? "paid" : "pending" })}
                </span>
              </span>
              <Amount className={AMOUNT}>{money(BigInt(line.amount.amount))}</Amount>
            </li>
          ))}
          <li className={ROW}>
            <span className={LABEL}>
              <span className="text-base [overflow-wrap:anywhere] text-ink">
                {t("toFund", { space: spaceName })}
              </span>
              <span className="text-sm text-muted">
                {t("toFundNote", { actual: money(intoFund), expected: money(throughFund) })}
              </span>
            </span>
            <Amount className={AMOUNT}>{money(throughFund)}</Amount>
          </li>
          {/* "Le faltan" says the direction in words, so the amount carries no sign; color is never the only signal. */}
          <li className={`${AMOUNT_ROW} items-center py-3`}>
            <span className={`${AMOUNT_ROW_LABEL} text-base font-semibold text-ink`}>
              {left > 0n ? t("left") : t("settled")}
            </span>
            {left > 0n ? <Amount className={`${AMOUNT} text-owe-ink`}>{money(left)}</Amount> : null}
          </li>
        </ul>
      </div>
    </Sheet>
  );
}
