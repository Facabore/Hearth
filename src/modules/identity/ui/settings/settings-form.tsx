"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MeDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, formatNumber } from "@/shared/ui/format/formatters";
import { FormatPreview } from "./format-preview";
import { PreferenceRow } from "./preference-row";
import {
  choose,
  reset,
  rowState,
  type FormatField,
  type FormatPatch,
  type Preferences,
} from "./settings-state";

const NUMBER_FORMATS = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const;
const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;
const TIME_FORMATS = ["H24", "H12"] as const;
const WEEK_STARTS = ["MONDAY", "SUNDAY"] as const;

/** HU-E9-13, the Settings artboard: no Save button; each choice is stored as it is made (ruling P137). */
export function SettingsForm({ me, api: injected }: { readonly me: MeDto; readonly api?: Api }) {
  const t = useTranslations("settings");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [preferences, setPreferences] = useState<Preferences>(me.preferences);
  const [problems, setProblems] = useState<Partial<Record<FormatField, Problem>>>({});

  const send = async (field: FormatField, change: { next: Preferences; patch: FormatPatch }) => {
    const previous = preferences;
    setPreferences(change.next);
    setProblems((current) => ({ ...current, [field]: undefined }));
    let problem: Problem;
    try {
      const { data, error, response } = await api.PATCH("/api/v1/me", { body: change.patch });
      if (data) {
        setPreferences(data.preferences);
        return;
      }
      problem = problemFrom(error, response);
    } catch (error) {
      problem = problemFrom(error, undefined);
    }
    setPreferences(previous);
    setProblems((current) => ({ ...current, [field]: problem }));
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
      onChoose={(value) => void send(field, choose(preferences, field, value))}
      onReset={() => void send(field, reset(preferences, field))}
      problem={problems[field] ?? null}
    />
  );

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
