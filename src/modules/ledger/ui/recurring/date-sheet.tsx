"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Icon, Sheet, VisuallyHidden } from "@/shared/ui";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { monthGrid } from "@/shared/ui/time/when";

const WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

export interface DateSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** The chosen date, or null for none; the calendar opens on its month, else on `today`'s. */
  readonly value: string | null;
  readonly today: string;
  readonly formats: Formats;
  readonly onChoose: (date: string | null) => void;
  /** The label of the button that chooses no date ("Sin fecha final"); without it a date must be chosen. */
  readonly noneLabel?: string;
}

/**
 * A calendar of one month to pick a day, as the record form's date sheet draws it (HU-E9-03), without a clock: a
 * recurrence's start, end or extension is a calendar date. Tapping a day chooses it and closes the sheet.
 */
export function DateSheet(props: DateSheetProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange} title={props.title}>
      {/* The content mounts on open, so the calendar starts from `value` each time the sheet opens. */}
      <Calendar {...props} />
    </Sheet>
  );
}

function Calendar({ value, today, formats, onChoose, onOpenChange, noneLabel }: DateSheetProps) {
  const t = useTranslations("recurrences.form");
  const common = useTranslations("common");
  const start = value ?? today;
  const [shown, setShown] = useState(() => ({
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)),
  }));
  const order = formats.weekStart === "MONDAY" ? WEEK : (["SUNDAY", ...WEEK.slice(0, 6)] as const);
  const cells = monthGrid(shown.year, shown.month, formats.weekStart);
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const moveMonth = (delta: 1 | -1) =>
    setShown(({ year, month }) => {
      const index = year * 12 + (month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    });
  const choose = (date: string | null) => {
    onChoose(date);
    onOpenChange(false);
  };
  const monthName = common("periodMonth", {
    month: common(`month.${shown.month as 1}`),
    year: String(shown.year),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => moveMonth(-1)}>
          <Icon name="back" />
          <VisuallyHidden>{t("previousMonth")}</VisuallyHidden>
        </Button>
        <p id="recurrence-month" className="font-medium text-ink">
          {monthName}
        </p>
        <Button variant="ghost" size="icon" onClick={() => moveMonth(1)}>
          <Icon name="chevronRight" />
          <VisuallyHidden>{t("nextMonth")}</VisuallyHidden>
        </Button>
      </div>
      <table role="grid" aria-labelledby="recurrence-month" className="w-full table-fixed text-center">
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
                      aria-pressed={date === value}
                      onClick={() => choose(date)}
                      className="size-11 rounded-full text-sm text-ink aria-pressed:bg-accent aria-pressed:text-on-accent"
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
      {noneLabel ? (
        <Button variant="secondary" size="lg" aria-pressed={value === null} onClick={() => choose(null)}>
          {noneLabel}
        </Button>
      ) : null}
    </div>
  );
}
