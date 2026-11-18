"use client";

import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";
import { TextField, type TextFieldProps } from "../atoms/text-field";
import { caretIn, exampleOf, filterNumber, inputModeOf, type NumberRule } from "../format/number-input";

interface Typed {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * Issue #164: what makes an input take only what `rule` holds, with the keypad of its kind. The filtered text is
 * written before React renders, so a dropped character or a regrouping leaves the caret where it was.
 */
export const numberInputProps = (rule: NumberRule, { value, onChange }: Typed) => ({
  value,
  inputMode: inputModeOf(rule),
  autoComplete: "off",
  onChange: (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const raw = input.value;
    const next = filterNumber(raw, rule, value);
    const caret = caretIn(raw, input.selectionStart ?? raw.length, next, rule, value);
    input.value = next;
    input.setSelectionRange(caret, caret);
    onChange(next);
  },
});

export type NumberFieldProps = Omit<
  TextFieldProps,
  "value" | "onChange" | "inputMode" | "leading" | "maxLength"
> &
  NumberRule &
  Typed & {
    /** The example under the field, as a decimal ("1.89"): the kind's own when omitted, none when false. */
    readonly example?: string | false;
    /** A unit after what is typed ("%"). */
    readonly unit?: string;
    /** A currency's ISO 4217 code, after what is typed as every amount reads it ("COP", P342). */
    readonly currency?: string;
  };

/**
 * Issue #164: a labelled number field. It drops what its kind cannot hold as it is typed, and says under it what to
 * type, as an example in the person's own number format ("Ej: 1.250,50"), after the caller's hint; an error already
 * says it, so the example goes while one shows. A hint line, not a tooltip: it works on touch and is read out.
 */
export function NumberField({
  kind,
  numberFormat,
  decimals,
  maxLength,
  value,
  onChange,
  example,
  unit,
  currency,
  hint,
  error,
  trailing,
  ...field
}: NumberFieldProps) {
  const t = useTranslations("common");
  // P342: a currency's code reads after the figure, at its size; the input keeps clear of the code's three letters.
  const suffix = unit ?? currency;
  const rule = { kind, numberFormat, decimals, maxLength };
  const sample = example === false || error ? null : exampleOf(rule, example);
  const line = sample ? t("numberExample", { example: sample }) : null;
  return (
    <TextField
      {...field}
      {...numberInputProps(rule, { value, onChange })}
      style={{ paddingRight: currency && "calc(1.75rem + 3ch)", ...field.style }}
      hint={
        hint && line ? (
          <>
            <span className="block">{hint}</span> <span className="block">{line}</span>
          </>
        ) : (
          (hint ?? line ?? undefined)
        )
      }
      error={error}
      trailing={
        suffix ? (
          <span
            aria-hidden="true"
            className={currency && field.large ? "px-3 text-2xl font-semibold text-muted" : "px-3 text-muted"}
          >
            {suffix}
          </span>
        ) : (
          trailing
        )
      }
    />
  );
}
