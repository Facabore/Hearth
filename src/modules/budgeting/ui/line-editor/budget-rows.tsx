"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, Icon, NumberField } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import { currencyTitle } from "@/shared/ui/format/currency-names";
import type { Formats } from "@/shared/ui/format/formatters";
import type { BudgetRow } from "./budget-draft";

/**
 * Ruling P342 (S7), board "Editar rubro · presupuesto por moneda": "Presupuesto" with one field per currency, the
 * amount at the left and its currency chip at the right (`onPick` opens the currency sheet for it), a ✕ while more
 * than one remains, and the note that nothing converts between them.
 */
export function BudgetRows({
  idPrefix,
  rows,
  spaceCurrency,
  formats,
  errorOf,
  onText,
  onPick,
  onRemove,
}: {
  readonly idPrefix: string;
  readonly rows: readonly BudgetRow[];
  readonly spaceCurrency: string;
  readonly formats: Pick<Formats, "numberFormat">;
  readonly errorOf: (currency: string) => string | undefined;
  readonly onText: (index: number, text: string) => void;
  readonly onPick: (index: number) => void;
  readonly onRemove: (index: number) => void;
}) {
  const t = useTranslations("budgeting.lineEditor.budgets");
  const locale = useLocale();
  const noted = rows.find((row) => row.currency !== spaceCurrency)?.currency;
  return (
    <>
      <div role="group" aria-labelledby={`${idPrefix}-budgets`} className="flex flex-col gap-2">
        <h2 id={`${idPrefix}-budgets`} className="text-sm font-medium text-ink">
          {t("heading")}
        </h2>
        {rows.map((row, index) => (
          <div key={row.currency} className="flex items-start gap-2">
            <div className="min-w-0 flex-1 [&_label]:sr-only">
              <NumberField
                id={`${idPrefix}-budget-${row.currency}`}
                label={t("field", { currency: row.currency })}
                kind="money"
                numberFormat={formats.numberFormat}
                decimals={currencyOf(row.currency).exponent}
                example={false}
                className="font-semibold"
                value={row.text}
                onChange={(text) => onText(index, text)}
                error={errorOf(row.currency)}
              />
            </div>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={t("chip", { name: currencyTitle(row.currency, locale), code: row.currency })}
              onClick={() => onPick(index)}
              className="mt-1 flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-4 text-sm font-semibold text-ink"
            >
              {row.currency}
              <Icon name="chevronDown" size={16} className="text-muted" />
            </button>
            {rows.length > 1 ? (
              <Button
                variant="ghost"
                size="iconCompact"
                className="mt-1 shrink-0"
                aria-label={t("remove", { currency: row.currency })}
                onClick={() => onRemove(index)}
              >
                <Icon name="close" size={20} />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {noted !== undefined ? (
        <p className="text-sm [overflow-wrap:anywhere] text-muted">{t("note", { currency: noted })}</p>
      ) : null}
    </>
  );
}
