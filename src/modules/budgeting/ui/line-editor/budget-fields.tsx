"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon } from "@/shared/ui";
import type { Formats } from "@/shared/ui/format/formatters";
import type { BudgetRow } from "./budget-draft";

/** Every currency loads with the sheet, on the first tap, never with the editor (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/** P342 (ADR 0004): a line in one currency never loads the fields of several, nor their allocation per currency. */
const BudgetRows = dynamic(() => import("./per-currency").then((module) => module.BudgetRows), {
  ssr: false,
});

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
  // The row whose currency is being chosen; `null` adds a budget.
  const [picking, setPicking] = useState<{ readonly index: number | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pick = (index: number | null) => {
    setLoaded(true);
    setPicking({ index });
  };
  const taken = new Set((rows ?? []).map((row) => row.currency));
  return (
    <>
      {rows === null ? null : (
        <BudgetRows
          idPrefix={idPrefix}
          rows={rows}
          spaceCurrency={spaceCurrency}
          formats={formats}
          errorOf={errorOf}
          onText={onText}
          onPick={pick}
          onRemove={onRemove}
        />
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
