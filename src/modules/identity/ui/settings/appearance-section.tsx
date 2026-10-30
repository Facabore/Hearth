"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { ChoiceGroup } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { readTheme, saveTheme, type Theme } from "@/shared/ui/theme/theme";
import { PreferenceRow } from "./preference-row";
import { SavedFlash, useSavedFlash } from "@/shared/ui/molecules/saved-flash";

const THEMES = ["system", "light", "dark"] as const;
export const APP_LOCALES = ["es", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

const subscribe = (onChange: () => void) => {
  addEventListener("storage", onChange);
  return () => removeEventListener("storage", onChange);
};

/**
 * The device's theme (ruling P135): stored on the device, read after hydration (the server always renders "system"),
 * and chosen here. Decision U8 (#224): Settings' summary row and its sheet read the same value.
 */
export const useDeviceTheme = () => {
  const stored = useSyncExternalStore(
    subscribe,
    () => readTheme(globalThis.localStorage),
    () => "system" as Theme,
  );
  const [chosen, setChosen] = useState<Theme | null>(null);
  const choose = (theme: Theme) => {
    saveTheme(theme);
    setChosen(theme);
  };
  return { theme: chosen ?? stored, choose };
};

/** The language a person reads, as Settings shows it: an unknown one reads as Spanish, the base catalog. */
export const appLocaleOf = (locale: string): AppLocale =>
  (APP_LOCALES as readonly string[]).includes(locale) ? (locale as AppLocale) : "es";

/**
 * HU-E9-13: the theme (a device setting, ruling P135) and the language, which reloads only the texts. Decision U8 (#224):
 * the content of the "Apariencia e idioma" sheet, which names it.
 */
export function AppearanceSection({
  theme,
  onTheme,
  locale,
  localeState,
  onLocale,
  onLocaleReset,
  problem,
  localeSaved = false,
}: {
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
  readonly locale: string;
  readonly localeState: "locked" | "default" | "custom";
  readonly onLocale: (locale: AppLocale) => void;
  readonly onLocaleReset: () => void;
  readonly problem: Problem | null;
  /** U5: the language was just stored. */
  readonly localeSaved?: boolean;
}) {
  const t = useTranslations("settings");
  // The theme is stored on the device at once, so it says so itself (U5).
  const themeSaved = useSavedFlash<"theme">();
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="relative flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t("field.theme")}</legend>
        <SavedFlash show={themeSaved.saved === "theme"} className="top-0" />
        <ChoiceGroup
          label={t("field.theme")}
          value={theme}
          options={THEMES.map((v) => ({ value: v, label: t(`theme.${v}`) }))}
          onValueChange={(next) => {
            onTheme(next);
            themeSaved.flash("theme");
          }}
        />
      </fieldset>
      <div className="flex flex-col gap-1">
        <PreferenceRow
          id="settings-locale"
          label={t("field.language")}
          value={appLocaleOf(locale)}
          options={APP_LOCALES.map((v) => ({ value: v, label: t(`language.${v}`) }))}
          state={localeState}
          onChoose={onLocale}
          onReset={onLocaleReset}
          problem={problem}
          saved={localeSaved}
        />
        <p className="text-sm text-muted">{t("language.hint")}</p>
      </div>
    </div>
  );
}
