"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Icon } from "@/shared/ui";
import { currencyTitle } from "@/shared/ui/format/currency-names";

/** Every currency loads with the sheet, on the first tap, never with the record route (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/**
 * P342 (boards 4 and 7): the movement's currency over its amount, "Dólar estadounidense (USD) ⌄", which opens the
 * currency sheet: "De este espacio" (the space's, always the default), then the person's "Favoritas", then "Todas".
 */
export function CurrencyChip({
  value,
  space,
  favorites,
  title,
  onChoose,
}: {
  readonly value: string;
  readonly space: { readonly name: string; readonly currency: string };
  readonly favorites: readonly string[];
  /** The sheet's title: "Moneda del gasto" or "Moneda del ingreso". */
  readonly title: string;
  readonly onChoose: (code: string) => void;
}) {
  const t = useTranslations("ledger.form.currency");
  const locale = useLocale();
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const label = t("value", { name: currencyTitle(value, locale), code: value });
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("chip", { currency: label })}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        className="flex min-h-11 max-w-full items-center gap-1.5 self-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink"
      >
        <span className="min-w-0 truncate">{label}</span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-muted" />
      </button>
      {opened ? (
        <CurrencySheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          value={value}
          primary={space.currency}
          primaryNote={t("spaceNote", { space: space.name })}
          favorites={favorites}
          onChoose={onChoose}
        />
      ) : null}
    </>
  );
}
