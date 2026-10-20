"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { ChoiceGroup } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { readTheme, saveTheme, type Theme } from "@/shared/ui/theme/theme";
import { PreferenceRow } from "./preference-row";

const THEMES = ["system", "light", "dark"] as const;
const LOCALES = ["es", "en"] as const;
type AppLocale = (typeof LOCALES)[number];

const subscribe = (onChange: () => void) => {
  addEventListener("storage", onChange);
  return () => removeEventListener("storage", onChange);
};

/** HU-E9-13: the theme (a device setting, ruling P135) and the language, which reloads only the texts. */
export function AppearanceSection({
  locale,
  localeState,
  onLocale,
  onLocaleReset,
  problem,
}: {
  readonly locale: string;
  readonly localeState: "locked" | "default" | "custom";
  readonly onLocale: (locale: AppLocale) => void;
  readonly onLocaleReset: () => void;
  readonly problem: Problem | null;
}) {
  const t = useTranslations("settings");
  // The device's stored theme, read after hydration (the server always renders "system").
  const stored = useSyncExternalStore(
    subscribe,
    () => readTheme(globalThis.localStorage),
    () => "system" as Theme,
  );
  const [chosen, setChosen] = useState<Theme | null>(null);
  return (
    <section aria-labelledby="settings-appearance" className="flex flex-col gap-5">
      <h2 id="settings-appearance" className="text-lg font-semibold text-ink">
        {t("appearance")}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">{t("field.theme")}</legend>
        <ChoiceGroup
          label={t("field.theme")}
          value={chosen ?? stored}
          options={THEMES.map((v) => ({ value: v, label: t(`theme.${v}`) }))}
          onValueChange={(theme) => {
            saveTheme(theme);
            setChosen(theme);
          }}
        />
      </fieldset>
      <div className="flex flex-col gap-1">
        <PreferenceRow
          id="settings-locale"
          label={t("field.language")}
          value={(LOCALES as readonly string[]).includes(locale) ? (locale as AppLocale) : "es"}
          options={LOCALES.map((v) => ({ value: v, label: t(`language.${v}`) }))}
          state={localeState}
          onChoose={onLocale}
          onReset={onLocaleReset}
          problem={problem}
        />
        <p className="text-sm text-muted">{t("language.hint")}</p>
      </div>
    </section>
  );
}
