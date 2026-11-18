"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Icon } from "../atoms/icon";
import { TextField } from "../atoms/text-field";
import { cn } from "../cn";
import { currencyOf } from "../format/currencies";
import { currencyTitle } from "../format/currency-names";
import { knownCurrencyCodes } from "../format/known-currencies";
import { StarIcon } from "../icons/star-icon";
import { Sheet } from "./sheet";

const searchable = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** One titled list of currencies in a currency sheet. */
export interface CurrencyListSection {
  readonly id: string;
  readonly heading: string;
  readonly codes: readonly string[];
}

/** Every known currency but `shown`, sorted by name in the person's language (board 13's "Todas"). */
export const otherCurrencies = (shown: readonly string[], locale: string): string[] =>
  knownCurrencyCodes()
    .filter((code) => !shown.includes(code))
    .map((code) => ({ code, name: currencyTitle(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map(({ code }) => code);

/**
 * D29 (board 13), P342 (boards 6 and 7): a currency's badge, which is the code itself as every amount reads it, its
 * name and, under it, the code, `note` and whether it has no decimals.
 */
export function CurrencyLabel({
  code,
  note,
  strong = false,
}: {
  readonly code: string;
  readonly note?: string;
  readonly strong?: boolean;
}) {
  const t = useTranslations("common.currencySheet");
  const locale = useLocale();
  const notes = [code, note, currencyOf(code).exponent === 0 ? t("noDecimals") : undefined].filter(Boolean);
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-ink"
      >
        {code}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-ink [overflow-wrap:anywhere]", strong && "font-semibold")}>
          {currencyTitle(code, locale)}
        </span>
        <span className="text-sm text-muted">{notes.join(" · ")}</span>
      </span>
    </>
  );
}

/**
 * The body of every currency sheet: a search by name or code, accents ignored, over every section, then each section
 * with a match, its rows drawn by `row`; it says so when nothing matches. The sheet owns `query`, to clear it on close.
 */
export function CurrencyList({
  id,
  searchLabel,
  query,
  onQuery,
  sections,
  row,
}: {
  readonly id: string;
  readonly searchLabel: string;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly sections: readonly CurrencyListSection[];
  readonly row: (code: string) => ReactNode;
}) {
  const t = useTranslations("common.currencySheet");
  const locale = useLocale();
  const wanted = searchable(query.trim());
  const matches = (code: string) =>
    wanted === "" ||
    searchable(code).includes(wanted) ||
    searchable(currencyTitle(code, locale)).includes(wanted);
  const shown = sections.map((section) => ({ ...section, codes: section.codes.filter(matches) }));
  return (
    <div className="flex flex-col gap-3">
      <TextField
        id={`${id}-search`}
        label={searchLabel}
        placeholder={t("searchPlaceholder")}
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        autoComplete="off"
      />
      {shown.every(({ codes }) => codes.length === 0) ? (
        <p className="text-sm text-muted">{t("none", { query: query.trim() })}</p>
      ) : null}
      {shown.map((section) =>
        section.codes.length > 0 ? (
          <section key={section.id} aria-labelledby={section.id} className="flex flex-col">
            <h3 id={section.id} className="text-xs font-semibold uppercase text-muted">
              {section.heading}
            </h3>
            <ul>{section.codes.map(row)}</ul>
          </section>
        ) : null,
      )}
    </div>
  );
}

/**
 * D29 (boards 12 and 13), P342 (board 7): the one currency picker, for an account's currency and a person's display
 * currency. A search by name or code over every currency, then "De este espacio" (`primary`, the space's currency or
 * the personal space's, always the default, which `primaryNote` says under it: "por defecto en Personal"), "Favoritas"
 * (the person's favorites in their order, without the primary) and "Todas" (the rest of the kernel's `CURRENCY_CODES`,
 * through `knownCurrencyCodes`, sorted by name), with a check on the chosen one; choosing closes it.
 */
export function CurrencySheet({
  open,
  onOpenChange,
  title,
  value,
  primary,
  primaryNote,
  primaryHeading,
  favorites = [],
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** The chosen code. */
  readonly value: string;
  readonly primary: string;
  readonly primaryNote?: string;
  /** The primary's section heading; "De este espacio" unless the caller names it otherwise. */
  readonly primaryHeading?: string;
  /** P342: the person's favorite currencies, in their order. */
  readonly favorites?: readonly string[];
  readonly onChoose: (code: string) => void;
}) {
  const t = useTranslations("common.currencySheet");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const favorite = [...new Set(favorites)].filter((code) => code !== primary);
  const sections: CurrencyListSection[] = [
    { id: "currency-sheet-space", heading: primaryHeading ?? t("ofThisSpace"), codes: [primary] },
    { id: "currency-sheet-favorites", heading: t("favorites"), codes: favorite },
    { id: "currency-sheet-all", heading: t("all"), codes: otherCurrencies([primary, ...favorite], locale) },
  ];
  const close = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const choose = (code: string) => {
    onChoose(code);
    close(false);
  };
  const row = (code: string) => {
    const chosen = code === value;
    return (
      <li key={code} className="border-b border-line last:border-b-0">
        <button
          type="button"
          aria-pressed={chosen}
          onClick={() => choose(code)}
          className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
        >
          <CurrencyLabel code={code} note={code === primary ? primaryNote : undefined} strong={chosen} />
          {chosen ? <Icon name="check" size={20} className="shrink-0 text-accent" /> : null}
        </button>
      </li>
    );
  };
  return (
    <Sheet open={open} onOpenChange={close} title={title}>
      <CurrencyList
        id="currency-sheet"
        searchLabel={t("search")}
        query={query}
        onQuery={setQuery}
        sections={sections}
        row={row}
      />
    </Sheet>
  );
}

/**
 * P342 (S2, board 6): the favorite currencies sheet, kept with the picker so both load as one chunk (ADR 0004). A
 * search over every currency, `favorites` first in the person's order with a filled star, then every other one with an
 * empty star. A star adds or removes its currency and `onChange` gets the whole list; `noteOf` adds a line under a
 * currency's name, and `problem` is a refused change's message.
 */
export function FavoriteCurrenciesSheet({
  open,
  onOpenChange,
  labels,
  favorites,
  noteOf,
  onChange,
  problem,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly labels: {
    readonly title: string;
    readonly search: string;
    readonly favorites: string;
    readonly others: string;
    /** The star's fixed name ("Moneda favorita: USD"); whether it is a favorite is `aria-pressed`, never the name (WAI-ARIA toggle buttons). */
    readonly star: (code: string) => string;
  };
  readonly favorites: readonly string[];
  readonly noteOf?: (code: string) => string | undefined;
  readonly onChange: (favorites: readonly string[]) => void;
  readonly problem: string | null;
}) {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const close = (next: boolean) => {
    if (!next) setQuery("");
    onOpenChange(next);
  };
  const row = (code: string) => {
    const favorite = favorites.includes(code);
    return (
      <li key={code} className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-b-0">
        <CurrencyLabel code={code} note={noteOf?.(code)} />
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={labels.star(code)}
          onClick={() => onChange(favorite ? favorites.filter((c) => c !== code) : [...favorites, code])}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            favorite ? "text-accent" : "text-muted",
          )}
        >
          <StarIcon filled={favorite} size={22} />
        </button>
      </li>
    );
  };
  return (
    <Sheet open={open} onOpenChange={close} title={labels.title}>
      <div className="flex flex-col gap-3">
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <CurrencyList
          id="favorite-currencies"
          searchLabel={labels.search}
          query={query}
          onQuery={setQuery}
          sections={[
            { id: "favorite-currencies-chosen", heading: labels.favorites, codes: favorites },
            {
              id: "favorite-currencies-all",
              heading: labels.others,
              codes: otherCurrencies(favorites, locale),
            },
          ]}
          row={row}
        />
      </div>
    </Sheet>
  );
}
