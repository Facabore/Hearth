"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { keypadInput, pointOf, type KeypadKey } from "./keypad-input";

const KEYS: readonly KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "back"];

/**
 * Ruling P291 (board B1 · 01): the record form's keypad, 1–9, 000, 0 and delete, in 48 px keys that write into the
 * amount as typing does. A currency typed in cents (`point`) gets the person's decimal point where "000" is. The keypad
 * sits beside the amount field, which a physical keyboard still types into.
 */
export function Keypad({
  value,
  onChange,
  numberFormat,
  exponent,
  point,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly numberFormat: NumberFormat;
  readonly exponent: number;
  readonly point: boolean;
}) {
  const t = useTranslations("ledger.form");
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((shown) => {
        const key = shown === "000" && point ? "point" : shown;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(keypadInput(value, key, numberFormat, exponent))}
            aria-label={key === "back" ? t("erase") : undefined}
            className="flex min-h-12 items-center justify-center rounded-xl bg-track text-[22px] text-ink tabular-nums active:bg-line"
          >
            {key === "back" ? <Icon name="backspace" /> : key === "point" ? pointOf(numberFormat) : key}
          </button>
        );
      })}
    </div>
  );
}
