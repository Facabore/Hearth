"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { LOCALES, localeCookie, type Locale } from "@/i18n/locale";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MeDto } from "@/shared/ui/api/dto";
import type { paths } from "@/shared/ui/api/schema";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatNumber } from "@/shared/ui/format/formatters";
import { ScreenHeader } from "@/shared/ui";
import { AppearanceSection } from "./appearance-section";
import { FormatPreview } from "./format-preview";
import { PreferenceRow } from "./preference-row";
import { RegionSection } from "./region-section";
import { useSavedFlash } from "./saved-flash";
import {
  choose,
  chooseRegion,
  regionState,
  reset,
  rowState,
  type FormatField,
  type Preferences,
  type RegionField,
} from "./settings-state";

const NUMBER_FORMATS = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const;
const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
const TIME_FORMATS = ["H24", "H12"] as const;
const WEEK_STARTS = ["MONDAY", "SUNDAY"] as const;
type Field = FormatField | RegionField;
type MePatch = NonNullable<paths["/api/v1/me"]["patch"]["requestBody"]>["content"]["application/json"];

/** Rulings P149 and P152: the stored language changes only here; the visitor cookie follows it. */
const rememberLocale = (locale: string) => {
  if ((LOCALES as readonly string[]).includes(locale)) document.cookie = localeCookie(locale as Locale);
};

/** HU-E9-13, the Settings artboard: no Save button; each choice is stored as it is made (ruling P137). */
export function SettingsForm({
  me,
  backHref,
  api: injected,
}: {
  readonly me: MeDto;
  /** The home of the space the person came from. */
  readonly backHref: string;
  readonly api?: Api;
}) {
  const t = useTranslations("settings");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [current, setCurrent] = useState<MeDto>(me);
  const [problems, setProblems] = useState<Partial<Record<Field, Problem>>>({});
  const { saved, flash } = useSavedFlash<Field>();
  const preferences = current.preferences;

  /** Optimistic: the change applies at once and is rolled back, with its error on its row, when refused. */
  const send = async (field: Field, next: MeDto, patch: MePatch) => {
    const previous = current;
    setCurrent(next);
    setProblems((all) => ({ ...all, [field]: undefined }));
    let problem: Problem;
    try {
      const { data, error, response } = await api.PATCH("/api/v1/me", { body: patch });
      if (data) {
        setCurrent(data);
        flash(field);
        if (field === "locale") {
          rememberLocale(data.locale);
          router.refresh();
        }
        return;
      }
      problem = problemFrom(error, response);
    } catch (error) {
      problem = problemFrom(error, undefined);
    }
    setCurrent(previous);
    setProblems((all) => ({ ...all, [field]: problem }));
  };
  const sendFormat = (field: FormatField, change: { next: Preferences; patch: MePatch }) =>
    void send(field, { ...current, preferences: change.next }, change.patch);
  const sendRegion = (field: RegionField, value: string) => {
    const { next, patch } = chooseRegion(current, field, value);
    void send(field, next, patch as MePatch);
  };

  const row = <F extends FormatField>(
    field: F,
    options: readonly { value: NonNullable<Preferences["stored"][F]>; label: string }[],
  ) => (
    <PreferenceRow
      id={`settings-${field}`}
      label={t(`field.${field as FormatField}`)}
      value={preferences.effective[field] as NonNullable<Preferences["stored"][F]>}
      options={options}
      state={rowState(preferences, field)}
      onChoose={(value) => sendFormat(field, choose(preferences, field, value))}
      onReset={() => sendFormat(field, reset(preferences, field))}
      problem={problems[field] ?? null}
      saved={saved === field}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Issue #176: on a long screen Volver stays reachable; the page's own background hides what scrolls under it. */}
      <div data-sticky-header className="sticky top-0 z-[5] -mx-4 bg-bg px-4">
        <ScreenHeader backHref={backHref} title={t("title")} />
      </div>
      {/* Issue #176: theme and language, the most changed, come first. */}
      <AppearanceSection
        locale={current.locale}
        localeState={regionState(current, "locale")}
        onLocale={(locale) => sendRegion("locale", locale)}
        onLocaleReset={() => sendRegion("locale", preferences.defaults.locale)}
        problem={problems.locale ?? null}
        localeSaved={saved === "locale"}
      />
      <FormatPreview formats={preferences.effective} />
      <section aria-labelledby="settings-formats" className="flex flex-col gap-5">
        <h2 id="settings-formats" className="text-lg font-semibold text-ink">
          {t("formats")}
        </h2>
        {row(
          "numberFormat",
          NUMBER_FORMATS.map((v) => ({ value: v, label: formatNumber("1234567.89", { numberFormat: v }) })),
        )}
        {row(
          "dateFormat",
          DATE_FORMATS.map((v) => ({ value: v, label: formatDate("2026-10-16", { dateFormat: v }) })),
        )}
        {row(
          "timeFormat",
          TIME_FORMATS.map((v) => ({ value: v, label: t(`timeFormat.${v}`) })),
        )}
        {row(
          "weekStart",
          WEEK_STARTS.map((v) => ({ value: v, label: t(`weekStart.${v}`) })),
        )}
      </section>
      <RegionSection
        timezone={current.timezone}
        state={regionState(current, "timezone")}
        onChoose={(zone) => sendRegion("timezone", zone)}
        onReset={() => sendRegion("timezone", preferences.defaults.timezone)}
        problem={problems.timezone ?? null}
        saved={saved === "timezone"}
      />
    </div>
  );
}
