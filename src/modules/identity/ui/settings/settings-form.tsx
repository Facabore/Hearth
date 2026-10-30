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
import { ScreenHeader, Sheet } from "@/shared/ui";
import { AppearanceSection, appLocaleOf, useDeviceTheme } from "./appearance-section";
import { FormatPreview, formatSample } from "./format-preview";
import { PreferenceRow } from "./preference-row";
import { RegionSection } from "./region-section";
import { SummaryRow } from "./summary-row";
import { useSavedFlash } from "@/shared/ui/molecules/saved-flash";
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

/**
 * HU-E9-13, the Settings artboard: no Save button; each choice is stored as it is made (ruling P137). Decision U8
 * (#224): three summary rows, each with its current values, and each opening its own sheet: Apariencia e idioma first
 * (#176), then Números y fechas, whose row writes the preview's own sample, then the time zone (ruling P266).
 */
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
  const [sheet, setSheet] = useState<"appearance" | "formats" | null>(null);
  const device = useDeviceTheme();
  const preferences = current.preferences;
  const sheetProps = (which: "appearance" | "formats") => ({
    open: sheet === which,
    onOpenChange: (open: boolean) => setSheet(open ? which : null),
  });

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
    <div className="flex flex-col gap-3">
      {/* Issue #176: on a long screen Volver stays reachable; the page's own background hides what scrolls under it. */}
      <div
        data-sticky-header
        className="sticky top-0 z-[5] -mx-4 bg-bg px-4 max-[359px]:-mx-3 max-[359px]:px-3"
      >
        {/* The screen draws the shell itself: a prefetch of the space's home would load its script again (#196). */}
        <ScreenHeader backHref={backHref} title={t("title")} prefetch={false} />
      </div>
      {/* Issue #176: theme and language, the most changed, come first. */}
      <SummaryRow
        title={t("appearance")}
        value={`${t(`theme.${device.theme}`)} · ${t(`language.${appLocaleOf(current.locale)}`)}`}
        onOpen={() => setSheet("appearance")}
      />
      <SummaryRow
        title={t("numbersAndDates")}
        value={`${formatSample(preferences.effective)} · ${t(`weekStartSummary.${preferences.effective.weekStart}`)}`}
        onOpen={() => setSheet("formats")}
      />
      <RegionSection
        timezone={current.timezone}
        state={regionState(current, "timezone")}
        onChoose={(zone) => sendRegion("timezone", zone)}
        onReset={() => sendRegion("timezone", preferences.defaults.timezone)}
        problem={problems.timezone ?? null}
        saved={saved === "timezone"}
      />
      <Sheet {...sheetProps("appearance")} title={t("appearance")}>
        <AppearanceSection
          theme={device.theme}
          onTheme={device.choose}
          locale={current.locale}
          localeState={regionState(current, "locale")}
          onLocale={(locale) => sendRegion("locale", locale)}
          onLocaleReset={() => sendRegion("locale", preferences.defaults.locale)}
          problem={problems.locale ?? null}
          localeSaved={saved === "locale"}
        />
      </Sheet>
      <Sheet {...sheetProps("formats")} title={t("numbersAndDates")}>
        <div className="flex flex-col gap-3">
          <FormatPreview formats={preferences.effective} />
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
        </div>
      </Sheet>
    </div>
  );
}
