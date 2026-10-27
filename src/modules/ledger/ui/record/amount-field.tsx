"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Icon, numberInputProps } from "@/shared/ui";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { exampleOf, type NumberRule } from "@/shared/ui/format/number-input";

/**
 * Issue #171, the Main artboard: the amount card, typed on the phone's own decimal keyboard (the 56 px keypad is
 * gone), focused when a new record opens so the keyboard comes up with it. U3: the money rule's input props, so the
 * digits are grouped as they are typed, in the person's number format (6000 reads 6.000), the caret stays after the
 * digit it was after, and the example under it says how to type one (issue #164).
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
    <div className="flex flex-col gap-0.5 rounded-2xl bg-surface px-3 py-2">
      <label htmlFor="record-amount" className="text-xs text-muted">
        {t("amount")}
      </label>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-[26px] leading-none font-semibold text-muted">
          {symbol}
        </span>
        <input
          ref={input}
          id="record-amount"
          {...numberInputProps(rule, { value, onChange })}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className="h-10 w-full min-w-0 rounded-lg bg-transparent px-1 text-[32px] font-[650] text-ink tabular-nums aria-invalid:ring-2 aria-invalid:ring-danger"
        />
      </div>
      {error ? (
        <p id="record-amount-error" className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : sample ? (
        <p id="record-amount-hint" className="text-xs text-muted">
          {common("numberExample", { example: sample })}
        </p>
      ) : null}
    </div>
  );
}
