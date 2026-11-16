"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Icon } from "../atoms/icon";
import { TextField } from "../atoms/text-field";
import { cn } from "../cn";
import { currencyOf } from "../format/currencies";
import { currencyTitle } from "../format/currency-names";
import { knownCurrencyCodes } from "../format/known-currencies";
import { Sheet } from "./sheet";

/** Board 13: after the primary currency, the ones most people hold. */
const COMMON = ["USD", "EUR"] as const;

/** A currency's badge: its symbol when Hearth has one, else the first two letters of its code (board 13: "MX"). */
const badgeOf = (code: string): string => {
  const { symbol } = currencyOf(code);
  return symbol === code ? code.slice(0, 2) : symbol;
};

const searchable = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * D29 (boards 12 and 13): the one currency sheet, for a new account's currency and a person's display currency. A
 * search by name or code, "Más usadas" (the primary currency, then USD and EUR) and "Todas" (every currency the kernel
 * knows, by name), with a check on the chosen one; choosing closes it. `primary` is the space's currency, or the
 * personal space's, and `primaryNote` says so under it ("la de Personal").
 */
export function CurrencySheet({
  open,
  onOpenChange,
  title,
  value,
  primary,
  primaryNote,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** The chosen code. */
  readonly value: string;
  readonly primary: string;
  readonly primaryNote?: string;
  readonly onChoose: (code: string) => void;
}) {
  const t = useTranslations("common.currencySheet");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const wanted = searchable(query.trim());
  const nameOf = (code: string) => currencyTitle(code, locale);
  const matches = (code: string) =>
    wanted === "" || searchable(code).includes(wanted) || searchable(nameOf(code)).includes(wanted);
  const mostUsed = [...new Set([primary, ...COMMON])];
  const all = knownCurrencyCodes()
    .filter((code) => !mostUsed.includes(code))
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const shownMostUsed = mostUsed.filter(matches);
  const shownAll = all.filter(({ code }) => matches(code)).map(({ code }) => code);
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
    const notes = [
      code,
      code === primary ? primaryNote : undefined,
      currencyOf(code).exponent === 0 ? t("noDecimals") : undefined,
    ].filter(Boolean);
    return (
      <li key={code} className="border-b border-line last:border-b-0">
        <button
          type="button"
          aria-pressed={chosen}
          onClick={() => choose(code)}
          className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
        >
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-ink"
          >
            {badgeOf(code)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("text-ink [overflow-wrap:anywhere]", chosen && "font-semibold")}>
              {nameOf(code)}
            </span>
            <span className="text-sm text-muted">{notes.join(" · ")}</span>
          </span>
          {chosen ? <Icon name="check" size={20} className="shrink-0 text-accent" /> : null}
        </button>
      </li>
    );
  };
  return (
    <Sheet open={open} onOpenChange={close} title={title}>
      <div className="flex flex-col gap-3">
        <TextField
          id="currency-sheet-search"
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {shownMostUsed.length === 0 && shownAll.length === 0 ? (
          <p className="text-sm text-muted">{t("none", { query: query.trim() })}</p>
        ) : null}
        {shownMostUsed.length > 0 ? (
          <section aria-labelledby="currency-sheet-most-used" className="flex flex-col">
            <h3 id="currency-sheet-most-used" className="text-xs font-semibold uppercase text-muted">
              {t("mostUsed")}
            </h3>
            <ul>{shownMostUsed.map(row)}</ul>
          </section>
        ) : null}
        {shownAll.length > 0 ? (
          <section aria-labelledby="currency-sheet-all" className="flex flex-col">
            <h3 id="currency-sheet-all" className="text-xs font-semibold uppercase text-muted">
              {t("all")}
            </h3>
            <ul>{shownAll.map(row)}</ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
