"use client";

import { useTranslations } from "next-intl";
import { Icon, NumberField } from "@/shared/ui";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { filterNumber, type NumberRule } from "@/shared/ui/format/number-input";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"] as const;

/**
 * HU-E9-03, the QuickAdd artboard: the amount first, typed or tapped on the keypad (56 px keys). U3: a money
 * NumberField, so the digits are grouped as they are typed, in the person's number format (6000 reads 6.000), the
 * caret stays after the digit it was after, and the example under it says how to type one (issue #164).
 */
export function AmountField({
  value,
  onChange,
  symbol,
  numberFormat,
  exponent,
  error,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly symbol: string;
  readonly numberFormat: NumberFormat;
  /** The currency's decimals: a currency with none has no point to type. */
  readonly exponent: number;
  readonly error?: string;
}) {
  const t = useTranslations("ledger.form");
  const rule: NumberRule = { kind: "money", numberFormat, decimals: exponent };
  const key = "flex h-14 items-center justify-center rounded-[14px] bg-track text-xl font-semibold text-ink";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        {/* Level with the typed figure: under the 26 px label row, centred on the 52 px field. */}
        <span aria-hidden="true" className="pt-9 text-2xl font-semibold text-muted">
          {symbol}
        </span>
        <div className="flex-1">
          <NumberField
            id="record-amount"
            label={t("amount")}
            {...rule}
            value={value}
            onChange={onChange}
            error={error}
            large
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={key}
            onClick={() => onChange(filterNumber(value + digit, rule, value))}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("backspace")}
          className={key}
          onClick={() => onChange(filterNumber(value.slice(0, -1), rule, value))}
        >
          <Icon name="backspace" />
        </button>
      </div>
    </div>
  );
}
