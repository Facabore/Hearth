"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { SavedFlash } from "@/shared/ui/molecules/saved-flash";
import { SummaryRow } from "./summary-row";

/** Loaded when first opened, in the currency picker's own chunk (ADR 0004). */
const FavoriteCurrenciesSheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.FavoriteCurrenciesSheet),
  { ssr: false },
);

/**
 * P342 (S2, board 6): Ajustes › "Monedas favoritas", the favorites' codes as the row's value ("COP · USD · EUR"),
 * opening the sheet whose stars add and remove them. A currency picker offers them after the space's own.
 */
export function FavoriteCurrenciesSection({
  favorites,
  personalSpace,
  onChange,
  problem,
  saved = false,
}: {
  /** The favorites as they apply: the personal space's currency until the person chose some. */
  readonly favorites: readonly string[];
  readonly personalSpace?: { readonly name: string; readonly currency: string };
  readonly onChange: (favorites: readonly string[]) => void;
  readonly problem: Problem | null;
  readonly saved?: boolean;
}) {
  const t = useTranslations("settings");
  const messageOf = useProblemMessage();
  const [open, setOpen] = useState(false);
  const message = problem ? messageOf(problem).message : null;
  return (
    <div className="relative flex flex-col gap-1">
      <SavedFlash show={saved} className="-top-5" />
      <SummaryRow
        title={t("field.favoriteCurrencies")}
        value={favorites.length > 0 ? favorites.join(" · ") : t("favoriteCurrencies.none")}
        onOpen={() => setOpen(true)}
        describedBy="settings-favorite-currencies-hint"
      />
      <p id="settings-favorite-currencies-hint" className="text-sm text-muted">
        {t("favoriteCurrencies.hint")}
      </p>
      {message ? <p className="text-sm text-danger">{message}</p> : null}
      {open ? (
        <FavoriteCurrenciesSheet
          open={open}
          onOpenChange={setOpen}
          labels={{
            title: t("field.favoriteCurrencies"),
            search: t("favoriteCurrencies.search"),
            favorites: t("favoriteCurrencies.chosen"),
            others: t("favoriteCurrencies.all"),
            star: (code, favorite) =>
              t(favorite ? "favoriteCurrencies.remove" : "favoriteCurrencies.add", { code }),
          }}
          favorites={favorites}
          noteOf={(code) =>
            code === personalSpace?.currency
              ? t("displayCurrency.spaceNote", { space: personalSpace.name })
              : undefined
          }
          onChange={onChange}
          problem={message}
        />
      ) : null}
    </div>
  );
}
