"use client";

import { useLocale, useTranslations } from "next-intl";
import { currencyOf } from "@/shared/ui/format/currencies";
import { currencyName } from "@/shared/ui/format/currency-names";
import { formatDayMonth } from "@/shared/ui/format/day-month";
import { formatMoney, formatNumber, NBSP, type Formats } from "@/shared/ui/format/formatters";
import { MoneyField } from "./form-rows";
import type { RateState } from "./use-exchange-rate";

/**
 * P342 (board 4): what the recorder's account in another currency moved, "Tu Visa Oro en COP pagó 205.000 COP", with
 * the day's rate it was suggested from ("Sugerido con 4.100 COP por dólar estadounidense (15 nov).") and "¿Cobró otro
 * valor? Escríbelo" to type what the bank really charged. Without a rate for the day it asks for the value at once; an
 * API problem about it (ExchangeRateRequired) is shown on that field. It only shows what the form read and computed.
 */
export function AccountLegCard({
  kind,
  account,
  movementCurrency,
  currency,
  shown,
  rate,
  value,
  onChange,
  typing,
  onType,
  error,
  formats,
}: {
  readonly kind: "EXPENSE" | "INCOME";
  readonly account: string;
  /** The movement's own currency: the rate's base. */
  readonly movementCurrency: string;
  /** The account's currency, which the leg is in. */
  readonly currency: string;
  /** The leg in the account's minor units, typed or suggested; null while neither is known. */
  readonly shown: string | null;
  readonly rate: RateState | null;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly typing: boolean;
  readonly onType: () => void;
  readonly error?: string | undefined;
  readonly formats: Formats;
}) {
  const t = useTranslations("ledger.form.leg");
  const common = useTranslations("common");
  const locale = useLocale();
  const moved = kind === "INCOME" ? "received" : "paid";
  const titleId = "record-leg-title";
  const note =
    rate?.status === "found"
      ? t("suggested", {
          rate: `${formatNumber(rate.rate, formats)}${NBSP}${currency}`,
          unit: currencyName(movementCurrency, locale),
          date: formatDayMonth(rate.on, common(`monthShort.${Number(rate.on.slice(5, 7)) as 1}`), formats),
        })
      : rate?.status === "missing"
        ? t("noRate")
        : null;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-1 rounded-2xl border border-accent-soft bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span id={titleId} className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">
          {t(`title.${moved}`, { account, currency })}
        </span>
        {shown === null ? null : (
          <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular-nums">
            {formatMoney({ amount: shown, currency }, formats)}
          </span>
        )}
      </div>
      {note === null ? null : <p className="text-xs text-muted">{note}</p>}
      {typing ? (
        <div className="mt-2">
          <MoneyField
            id="record-account-amount"
            label={t(`field.${moved}`, { account })}
            currency={currency}
            numberFormat={formats.numberFormat}
            exponent={currencyOf(currency).exponent}
            value={value}
            onChange={onChange}
            error={error}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onType}
          className="-ml-1 min-h-11 self-start px-1 text-left text-sm font-semibold text-accent-strong"
        >
          {t(`other.${moved}`)}
        </button>
      )}
    </div>
  );
}
