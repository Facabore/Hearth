"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Icon } from "@/shared/ui";
import { currencyName, currencyTitle } from "@/shared/ui/format/currency-names";

/** Loaded when first opened, so the list of every currency stays out of the accounts route (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/**
 * D29 (board 12): a new account's "Moneda", the space's by default, drawn as a select that opens the currency sheet
 * (board 13, "Moneda de la cuenta"). Its hint says the space's currency and that the choice is fixed once the account
 * has movements.
 */
export function AccountCurrencyField({
  id,
  value,
  space,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly space: { readonly name: string; readonly currency: string };
  readonly onChange: (currency: string) => void;
}) {
  const t = useTranslations("accounts");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {t("field.currency")}
      </span>
      <button
        id={id}
        type="button"
        aria-labelledby={`${id}-label ${id}`}
        aria-describedby={`${id}-hint`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-field bg-surface px-4 text-left text-ink"
      >
        <span className="min-w-0 truncate">
          {t("currencyField.value", { name: currencyTitle(value, locale), code: value })}
        </span>
        <Icon name="chevronDown" size={20} className="shrink-0" />
      </button>
      <p id={`${id}-hint`} className="text-sm text-muted">
        {t("currencyField.hint", {
          space: space.name,
          name: currencyName(space.currency, locale),
          code: space.currency,
        })}
      </p>
      {open ? (
        <CurrencySheet
          open={open}
          onOpenChange={setOpen}
          title={t("currencyField.sheetTitle")}
          value={value}
          primary={space.currency}
          primaryNote={t("currencyField.spaceNote", { space: space.name })}
          onChoose={onChange}
        />
      ) : null}
    </div>
  );
}
