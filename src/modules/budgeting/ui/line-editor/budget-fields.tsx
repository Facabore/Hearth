"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon, NumberField } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import { currencyTitle } from "@/shared/ui/format/currency-names";
import type { Formats } from "@/shared/ui/format/formatters";
import type { BudgetRow } from "./budget-draft";

/** Every currency loads with the sheet, on the first tap, never with the editor (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/**
 * Ruling P342 (S7), board "Editar rubro · presupuesto por moneda": "Presupuesto" with one field per currency, the
 * amount at the left and its currency chip at the right (which opens the currency sheet), a ✕ while more than one
 * remains, "+ Agregar presupuesto en otra moneda" and the note that nothing converts. With `rows` null the line has
 * its one "Planeado" field, and only the add button is drawn here.
 */
export function BudgetFields({
  idPrefix,
  rows,
  spaceCurrency,
  favorites,
  formats,
  errorOf,
  onText,
  onAdd,
  onCurrency,
  onRemove,
}: {
  readonly idPrefix: string;
  readonly rows: readonly BudgetRow[] | null;
  readonly spaceCurrency: string;
  readonly favorites: readonly string[];
  readonly formats: Pick<Formats, "numberFormat">;
  readonly errorOf: (currency: string) => string | undefined;
  readonly onText: (index: number, text: string) => void;
  readonly onAdd: (currency: string) => void;
  readonly onCurrency: (index: number, currency: string) => void;
  readonly onRemove: (index: number) => void;
}) {
  const t = useTranslations("budgeting.lineEditor.budgets");
  const locale = useLocale();
  // The row whose currency is being chosen; `null` adds a budget.
  const [picking, setPicking] = useState<{ readonly index: number | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pick = (index: number | null) => {
    setLoaded(true);
    setPicking({ index });
  };
  const taken = new Set((rows ?? []).map((row) => row.currency));
  const noted = rows?.find((row) => row.currency !== spaceCurrency)?.currency;
  return (
    <>
      {rows === null ? null : (
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
                onClick={() => pick(index)}
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
      )}
      <Button
        variant="ghost"
        size="compact"
        className="-mx-2 self-start font-medium"
        onClick={() => pick(null)}
      >
        <Icon name="plus" size={18} />
        {t("add")}
      </Button>
      {rows !== null && noted !== undefined ? (
        <p className="text-sm [overflow-wrap:anywhere] text-muted">{t("note", { currency: noted })}</p>
      ) : null}
      {loaded ? (
        <CurrencySheet
          open={picking !== null}
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          title={t("sheetTitle")}
          value={picking?.index == null ? spaceCurrency : (rows?.[picking.index]?.currency ?? spaceCurrency)}
          primary={spaceCurrency}
          favorites={favorites}
          onChoose={(code) => {
            if (picking === null || taken.has(code)) return;
            if (picking.index === null) onAdd(code);
            else onCurrency(picking.index, code);
          }}
        />
      ) : null}
    </>
  );
}
