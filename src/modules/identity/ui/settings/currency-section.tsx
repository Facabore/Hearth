"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { currencyTitle } from "@/shared/ui/format/currency-names";
import { SavedFlash } from "@/shared/ui/molecules/saved-flash";
import { SummaryRow } from "./summary-row";

/** Loaded when first opened, as the accounts form loads it (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/**
 * D29, slice MC4 (board 11): "Moneda de tus totales", the currency Inicio and the personal view add everything up in.
 * Null follows the personal space's currency, and choosing that currency in the sheet goes back to following it, so
 * the person's totals move with their personal space unless they chose another one. This supersedes ruling P126's
 * "no currency row".
 */
export function CurrencySection({
  displayCurrency,
  personalSpace,
  favorites = [],
  onChoose,
  problem,
  saved = false,
}: {
  /** The stored display currency; null follows the personal space's. */
  readonly displayCurrency: string | null;
  readonly personalSpace: { readonly name: string; readonly currency: string };
  /** P342: the person's favorite currencies, offered after the personal space's. */
  readonly favorites?: readonly string[];
  readonly onChoose: (currency: string | null) => void;
  readonly problem: Problem | null;
  readonly saved?: boolean;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const messageOf = useProblemMessage();
  const [open, setOpen] = useState(false);
  const shown = displayCurrency ?? personalSpace.currency;
  const value = t("displayCurrency.value", { name: currencyTitle(shown, locale), code: shown });
  return (
    <div className="relative flex flex-col gap-1">
      <SavedFlash show={saved} className="-top-5" />
      <SummaryRow
        title={t("field.displayCurrency")}
        value={
          displayCurrency === null
            ? t("displayCurrency.followsPersonal", { value, space: personalSpace.name })
            : value
        }
        onOpen={() => setOpen(true)}
        describedBy="settings-display-currency-hint"
      />
      <p id="settings-display-currency-hint" className="text-sm text-muted">
        {t("displayCurrency.hint")}
      </p>
      {problem ? <p className="text-sm text-danger">{messageOf(problem).message}</p> : null}
      {open ? (
        <CurrencySheet
          open={open}
          onOpenChange={setOpen}
          title={t("field.displayCurrency")}
          value={shown}
          primary={personalSpace.currency}
          primaryNote={t("displayCurrency.spaceNote", { space: personalSpace.name })}
          primaryHeading={t("displayCurrency.personalHeading", { space: personalSpace.name })}
          favorites={favorites}
          onChoose={(code) => onChoose(code === personalSpace.currency ? null : code)}
        />
      ) : null}
    </div>
  );
}
