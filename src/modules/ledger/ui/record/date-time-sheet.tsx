"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { Button, ChoiceGroup, Icon, Sheet, VisuallyHidden } from "@/shared/ui";
import { formatDate, type Formats, type Wall } from "@/shared/ui/format/formatters";
import { monthGrid, stepHour, stepMinutes, withHalf } from "@/shared/ui/time/when";
import { whenLabel, type When } from "./when-label";

export interface DateTimeSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly value: When;
  readonly today: string;
  readonly now: When;
  readonly formats: Formats;
  readonly onApply: (when: When) => void;
}

const WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const SHORTCUTS = [0, 15, 30, 45] as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** HU-E9-03, the QuickAdd artboard's "Fecha y hora": quick days, a month calendar and a clock; no "no time" (P129). */
export function DateTimeSheet(props: DateTimeSheetProps) {
  const t = useTranslations("ledger.when");
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} title={t("title")}>
      {/* The content mounts on open, so the draft starts from `value` each time the sheet opens. */}
      <SheetBody {...props} />
    </Sheet>
  );
}

function SheetBody({ value, today, now, formats, onApply, onOpenChange }: DateTimeSheetProps) {
  const t = useTranslations("ledger");
  const common = useTranslations("common");
  const [draft, setDraft] = useState<When>(value);
  const [shown, setShown] = useState(() => ({
    year: Number(value.date.slice(0, 4)),
    month: Number(value.date.slice(5, 7)),
  }));
  const days = {
    today: t("day.today"),
    yesterday: t("day.yesterday"),
    dayBeforeYesterday: t("day.dayBeforeYesterday"),
  };
  const quick = [0, -1, -2].map((d) => addDays(today as LocalDate, d) as string);
  const setWall = (wall: Wall) => setDraft((current) => ({ ...current, wall }));
  const order = formats.weekStart === "MONDAY" ? WEEK : (["SUNDAY", ...WEEK.slice(0, 6)] as const);
  const cells = monthGrid(shown.year, shown.month, formats.weekStart);
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const moveMonth = (delta: 1 | -1) =>
    setShown(({ year, month }) => {
      const index = year * 12 + (month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  const monthName = t("when.month", { month: common(`month.${shown.month as 1}`), year: String(shown.year) });
  const h12 = formats.timeFormat === "H12";
  // The glyphs are generated content, so the clock group's text stays "<hour> : <minute>".
  const stepper =
    "flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-xl text-ink";
  const stepDown = `${stepper} before:content-['−']`;
  const stepUp = `${stepper} before:content-['+']`;
  return (
    <div className="flex flex-col gap-5">
      <ChoiceGroup
        label={t("when.day")}
        value={quick.includes(draft.date) ? draft.date : ""}
        onValueChange={(date) => setDraft((current) => ({ ...current, date }))}
        options={quick.map((date, i) => ({
          value: date,
          label: (
            <span className="flex flex-col py-1">
              <span>{days[(["today", "yesterday", "dayBeforeYesterday"] as const)[i]!]}</span>
              <span className="text-xs text-muted">{formatDate(date, formats)}</span>
            </span>
          ),
        }))}
      />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => moveMonth(-1)}>
            <Icon name="back" />
            <VisuallyHidden>{t("when.previousMonth")}</VisuallyHidden>
          </Button>
          <p id="when-month" className="font-medium text-ink">
            {monthName}
          </p>
          <Button variant="ghost" size="icon" onClick={() => moveMonth(1)}>
            <Icon name="chevronRight" />
            <VisuallyHidden>{t("when.nextMonth")}</VisuallyHidden>
          </Button>
        </div>
        <table role="grid" aria-labelledby="when-month" className="w-full table-fixed text-center">
          <thead>
            <tr>
              {order.map((day, i) => (
                <th key={`${day}-${i}`} scope="col" className="py-1 text-xs font-medium text-muted">
                  {common(`weekdayShort.${day}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((date, d) => (
                  <td key={date ?? `empty-${w}-${d}`} className="p-0.5">
                    {date ? (
                      <button
                        type="button"
                        aria-label={formatDate(date, formats)}
                        aria-pressed={date === draft.date}
                        disabled={date > today}
                        onClick={() => setDraft((current) => ({ ...current, date }))}
                        className="size-11 rounded-full text-sm text-ink aria-pressed:bg-accent aria-pressed:text-on-accent disabled:opacity-40"
                      >
                        {Number(date.slice(8))}
                      </button>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        role="group"
        aria-label={t("when.time")}
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3"
      >
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t("when.hourDown")}
            className={stepDown}
            onClick={() => setWall(stepHour(draft.wall, -1))}
          ></button>
          <output className="w-10 text-center text-3xl font-semibold text-ink">
            {h12 ? draft.wall.hour % 12 || 12 : pad(draft.wall.hour)}
          </output>
          <button
            type="button"
            aria-label={t("when.hourUp")}
            className={stepUp}
            onClick={() => setWall(stepHour(draft.wall, 1))}
          ></button>
        </div>
        <span aria-hidden="true" className="text-3xl text-muted">
          {" : "}
        </span>
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t("when.minuteDown")}
            className={stepDown}
            onClick={() => setWall(stepMinutes(draft.wall, -5))}
          ></button>
          <output className="w-10 text-center text-3xl font-semibold text-ink">
            {pad(draft.wall.minute)}
          </output>
          <button
            type="button"
            aria-label={t("when.minuteUp")}
            className={stepUp}
            onClick={() => setWall(stepMinutes(draft.wall, 5))}
          ></button>
        </div>
        {h12 ? (
          // Its own row, so the segments are wide enough to tap and never meet the steppers.
          <div className="w-full max-w-48">
            <ChoiceGroup
              label={t("when.half")}
              value={draft.wall.hour < 12 ? "AM" : "PM"}
              onValueChange={(half) => setWall(withHalf(draft.wall, half))}
              options={[
                { value: "AM" as const, label: t("when.am") },
                { value: "PM" as const, label: t("when.pm") },
              ]}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SHORTCUTS.map((minute) => (
          <Button
            key={minute}
            variant="secondary"
            className="h-11 rounded-full px-4 text-sm"
            aria-pressed={draft.wall.minute === minute}
            onClick={() => setWall({ hour: draft.wall.hour, minute })}
          >
            :{pad(minute)}
          </Button>
        ))}
        <Button variant="secondary" className="h-11 rounded-full px-4 text-sm" onClick={() => setDraft(now)}>
          {t("when.now")}
        </Button>
      </div>
      <Button
        size="lg"
        onClick={() => {
          onApply(draft);
          onOpenChange(false);
        }}
      >
        {t("when.apply", { label: whenLabel(draft, today, formats, days) })}
      </Button>
    </div>
  );
}
