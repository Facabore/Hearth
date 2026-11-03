"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Icon, numberInputProps } from "@/shared/ui";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { exampleOf, type NumberRule } from "@/shared/ui/format/number-input";

/**
 * Ruling P291 (board B1 · 01): the amount as a large centred figure, written by the form's keypad (`Keypad`) and still
 * typed on a physical keyboard. The phone's own keyboard stays down (`inputMode="none"`), since the keypad is on screen.
 * U3: the money rule's input props, so the digits are grouped as they are typed, in the person's number format (6000
 * reads 6.000), and the caret stays after the digit it was after; the example of how to type one is read out (#164).
 */
export function AmountField({
  value,
  onChange,
  symbol,
  numberFormat,
  exponent,
  error,
  autoFocus = false,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly symbol: string;
  readonly numberFormat: NumberFormat;
  /** The currency's decimals: a currency with none has no point to type. */
  readonly exponent: number;
  readonly error?: string | undefined;
  /** Focus the amount once, on mount: a new record, never an edit. */
  readonly autoFocus?: boolean;
}) {
  const t = useTranslations("ledger.form");
  const common = useTranslations("common");
  const input = useRef<HTMLInputElement>(null);
  // Once, when the form opens: a later change of the prop never takes the focus back.
  const focusOnOpen = useRef(autoFocus);
  useEffect(() => {
    if (focusOnOpen.current) input.current?.focus();
  }, []);
  const rule: NumberRule = { kind: "money", numberFormat, decimals: exponent };
  const sample = error ? null : exampleOf(rule);
  const described = error ? "record-amount-error" : sample ? "record-amount-hint" : undefined;
  return (
    <div className="flex flex-col items-center gap-1">
      <label htmlFor="record-amount" className="sr-only">
        {t("amount")}
      </label>
      <div className="flex max-w-full items-baseline justify-center gap-2 text-[40px] leading-tight font-bold text-ink tabular-nums">
        <span aria-hidden="true">{symbol}</span>
        <input
          ref={input}
          id="record-amount"
          {...numberInputProps(rule, { value, onChange })}
          inputMode="none"
          placeholder="0"
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          // As wide as what is typed, so the figure stays centred with its symbol.
          style={{ width: `${Math.max(value.length, 1) + 0.25}ch` }}
          className="min-w-0 rounded-lg bg-transparent text-center placeholder:text-muted aria-invalid:ring-2 aria-invalid:ring-danger"
        />
      </div>
      {error ? (
        <p id="record-amount-error" className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : sample ? (
        <p id="record-amount-hint" className="sr-only">
          {common("numberExample", { example: sample })}
        </p>
      ) : null}
    </div>
  );
}
