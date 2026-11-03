"use client";

import { useTranslations } from "next-intl";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDate, formatNumber } from "@/shared/ui/format/formatters";
import { FormatPreview } from "./format-preview";
import { PreferenceRow } from "./preference-row";
import { choose, reset, rowState, type FormatField, type Preferences } from "./settings-state";

const NUMBER_FORMATS = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const;
const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
const TIME_FORMATS = ["H24", "H12"] as const;
const WEEK_STARTS = ["MONDAY", "SUNDAY"] as const;

/** A format choice the form stores: the preferences it leads to and the patch that stores them. */
export type FormatChange = ReturnType<typeof choose>;

/**
 * HU-E9-13, the Números y fechas sheet: the preview and one row per format. It loads when the sheet opens, so Ajustes'
 * route carries only its summary rows (ADR 0004).
 */
export function FormatsFields({
  preferences,
  problems,
  saved,
  onChange,
}: {
  readonly preferences: Preferences;
  readonly problems: Partial<Record<FormatField, Problem>>;
  readonly saved: string | null;
  readonly onChange: (field: FormatField, change: FormatChange) => void;
}) {
  const t = useTranslations("settings");
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
      onChoose={(value) => onChange(field, choose(preferences, field, value))}
      onReset={() => onChange(field, reset(preferences, field))}
      problem={problems[field] ?? null}
      saved={saved === field}
    />
  );
  return (
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
  );
}
