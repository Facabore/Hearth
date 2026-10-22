"use client";

import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, type ChangeEvent } from "react";
import { Icon, TextField } from "@/shared/ui";
import { caretAfter, groupAmountInput, significantBefore } from "@/shared/ui/format/amount-input";
import type { NumberFormat } from "@/shared/ui/format/formatters";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"] as const;

/**
 * HU-E9-03, the QuickAdd artboard: the amount first, typed or tapped on the keypad (56 px keys). U3: the digits are
 * grouped as they are typed, in the person's number format, so 6000 reads 6.000; the caret stays after the digit it
 * was after, and the text still parses to the digits typed.
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
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  // Regrouping replaces the text, which sends the caret to the end: put it back once React has written the new value.
  useLayoutEffect(() => {
    if (caret.current !== null && input.current)
      input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const typed = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const next = groupAmountInput(raw, numberFormat, exponent, value);
    caret.current = caretAfter(
      next,
      significantBefore(raw, event.target.selectionStart ?? raw.length, numberFormat),
      numberFormat,
    );
    onChange(next);
  };
  const key = "flex h-14 items-center justify-center rounded-[14px] bg-track text-xl font-semibold text-ink";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <span aria-hidden="true" className="pb-3 text-2xl font-semibold text-muted">
          {symbol}
        </span>
        <div className="flex-1">
          <TextField
            ref={input}
            id="record-amount"
            label={t("amount")}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={typed}
            error={error}
            className="text-2xl font-semibold"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={key}
            onClick={() => onChange(groupAmountInput(value + digit, numberFormat, exponent, value))}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("backspace")}
          className={key}
          onClick={() => onChange(groupAmountInput(value.slice(0, -1), numberFormat, exponent, value))}
        >
          <Icon name="backspace" />
        </button>
      </div>
    </div>
  );
}
