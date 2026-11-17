"use client";

import { useTranslations } from "next-intl";
import { formatDayMonthYear } from "@/shared/ui/format/day-month";
import type { Formats } from "@/shared/ui/format/formatters";
import { relativeDay } from "@/shared/ui/time/when";

/** The day a movement is labelled with, as Movimientos labels it: "Hoy", "Ayer", "3 oct", "12 mar 2025". */
export function useDayLabel(formats: Formats, today: string): (date: string) => string {
  const common = useTranslations("common");
  const ledger = useTranslations("ledger");
  return (date) => {
    const day = relativeDay(date, today);
    return day === "today" || day === "yesterday"
      ? ledger(`day.${day}`)
      : formatDayMonthYear(date, common(`monthShort.${Number(date.slice(5, 7)) as 1}`), formats, today);
  };
}
