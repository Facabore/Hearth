"use client";

import { useTranslations } from "next-intl";
import { Icon, TextField } from "@/shared/ui";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"] as const;

/** HU-E9-03, the QuickAdd artboard: the amount first, typed or tapped on the keypad (56 px keys). */
export function AmountField({
  value,
  onChange,
  symbol,
  error,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly symbol: string;
  readonly error?: string;
}) {
  const t = useTranslations("ledger.form");
  const key = "flex h-14 items-center justify-center rounded-[14px] bg-track text-xl font-semibold text-ink";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <span aria-hidden="true" className="pb-3 text-2xl font-semibold text-muted">
          {symbol}
        </span>
        <div className="flex-1">
          <TextField
            id="record-amount"
            label={t("amount")}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            error={error}
            className="text-2xl font-semibold"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <button key={digit} type="button" className={key} onClick={() => onChange(value + digit)}>
            {digit}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("backspace")}
          className={key}
          onClick={() => onChange(value.slice(0, -1))}
        >
          <Icon name="backspace" />
        </button>
      </div>
    </div>
  );
}
