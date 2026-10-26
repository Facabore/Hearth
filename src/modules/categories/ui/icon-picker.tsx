"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { SYMBOLS, type SymbolName } from "@/shared/kernel/style";
import { ChoiceGroup, Sheet, SymbolIcon, TextField, VisuallyHidden } from "@/shared/ui";
import {
  emojiIdOf,
  iconKey,
  isLibrarySymbol,
  isSameIcon,
  librarySections,
  quickChoices,
  searchLibrary,
  type IconChoice,
  type IconTab,
} from "./style-library";

const isSymbol = (name: string): name is SymbolName => (SYMBOLS as readonly string[]).includes(name);
const TABS = ["SYMBOL", "EMOJI"] as const satisfies readonly IconTab[];

/** A choice's catalog label; an emoji outside the library is named by itself. */
const useIconLabel = () => {
  const t = useTranslations("categories");
  return (icon: IconChoice): string => {
    if (icon.kind === "SYMBOL") return isLibrarySymbol(icon.name) ? t(`symbol.${icon.name}`) : icon.name;
    const id = emojiIdOf(icon.value);
    return id ? t(`emoji.${id}`) : icon.value;
  };
};

function Glyph({ icon, size = 24 }: { readonly icon: IconChoice; readonly size?: number }) {
  return icon.kind === "SYMBOL" ? (
    <SymbolIcon name={isSymbol(icon.name) ? icon.name : "dots"} size={size} />
  ) : (
    // P59: a grapheme wider than one glyph (a ZWJ chain the font does not join) is clipped to the slot.
    <span aria-hidden="true" className="block max-w-[1.5em] overflow-hidden text-xl leading-none">
      {icon.value}
    </span>
  );
}

/**
 * HU-E9-04: an "Icons" and an "Emoji" tab, each with 11 quick choices and a "see all" tile that opens the library over
 * the sheet that asked for it, which keeps its draft. Shared by the category sheet and the new-group sheet.
 */
export function IconPicker({
  value,
  onValueChange,
}: {
  readonly value: IconChoice;
  readonly onValueChange: (value: IconChoice) => void;
}) {
  const t = useTranslations("categories.icons");
  const labelOf = useIconLabel();
  const [tab, setTab] = useState<IconTab>(value.kind);
  const [library, setLibrary] = useState(false);
  const choices = quickChoices(tab, value);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">{t("label")}</legend>
      <ChoiceGroup
        label={t("tabs")}
        value={tab}
        onValueChange={setTab}
        options={TABS.map((kind) => ({ value: kind, label: t(kind) }))}
      />
      <div className="relative">
        <ChoiceGroup
          label={t(tab)}
          layout="tiles"
          value={iconKey(value)}
          onValueChange={(key) => onValueChange(choices.find((choice) => iconKey(choice) === key)!)}
          options={choices.map((choice) => ({
            value: iconKey(choice),
            label: (
              <>
                <Glyph icon={choice} />
                <VisuallyHidden>{labelOf(choice)}</VisuallyHidden>
              </>
            ),
          }))}
        />
        {/* The twelfth tile of the 6 × 2 grid: same width as a column (gap 4 px), square like the others. */}
        <button
          type="button"
          onClick={() => setLibrary(true)}
          className="absolute right-0 bottom-0 flex aspect-square w-[calc((100%-20px)/6)] min-h-11 items-center justify-center rounded-[14px] border border-dashed border-line px-0.5 text-center text-[11px] leading-tight font-medium text-ink"
        >
          {t("seeAll")}
        </button>
      </div>
      {library ? (
        <IconLibrarySheet
          tab={tab}
          current={value}
          onClose={() => setLibrary(false)}
          onChoose={(icon) => {
            setTab(icon.kind);
            onValueChange(icon);
            setLibrary(false);
          }}
        />
      ) : null}
    </fieldset>
  );
}

/**
 * HU-E9-04: the icon library, a sheet stacked over the one that opened it: the same tabs, a search over a choice's label
 * or its section's name (case and accents ignored), and the choices in sections. Choosing applies and closes; back
 * closes it unchanged.
 */
function IconLibrarySheet({
  tab: initialTab,
  current,
  onClose,
  onChoose,
}: {
  readonly tab: IconTab;
  readonly current: IconChoice;
  readonly onClose: () => void;
  readonly onChoose: (icon: IconChoice) => void;
}) {
  const t = useTranslations("categories.icons");
  const catalog = useTranslations("categories");
  const id = useId();
  const [tab, setTab] = useState<IconTab>(initialTab);
  const [query, setQuery] = useState("");
  const sections = searchLibrary(librarySections(tab, catalog), query);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("library")}
    >
      <div className="flex flex-col gap-3">
        <ChoiceGroup
          label={t("tabs")}
          value={tab}
          onValueChange={setTab}
          options={TABS.map((kind) => ({ value: kind, label: t(kind) }))}
        />
        <TextField
          id={`${id}-search`}
          type="search"
          label={t("search")}
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        {sections.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            {t("noMatch", { query: query.trim() })}
          </p>
        ) : (
          sections.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`${id}-${section.id}`}
              className="flex flex-col gap-1.5"
            >
              <h3 id={`${id}-${section.id}`} className="text-sm font-semibold text-muted">
                {section.name}
              </h3>
              <ul className="grid grid-cols-6 gap-1">
                {section.choices.map((choice) => (
                  <li key={iconKey(choice.icon)}>
                    <button
                      type="button"
                      aria-label={choice.label}
                      aria-pressed={isSameIcon(choice.icon, current)}
                      onClick={() => onChoose(choice.icon)}
                      className="flex aspect-square w-full min-h-11 items-center justify-center rounded-[14px] border border-line text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft"
                    >
                      <Glyph icon={choice.icon} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Sheet>
  );
}
