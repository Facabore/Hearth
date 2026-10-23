import { useTranslations } from "next-intl";
import type { PeriodDto, SpaceDto } from "../api/dto";
import { formatDate, type Formats } from "../format/formatters";
import { periodName } from "../time/period-name";

/**
 * Ruling P205: a period as words: "noviembre 2026" for a calendar month (MONTHLY day 1), else its two dates in the
 * person's format. Works in Server and Client Components alike (next-intl's `useTranslations`).
 */
export const usePeriodText = () => {
  const t = useTranslations("common");
  return (
    period: PeriodDto,
    policy: SpaceDto["periodPolicy"],
    formats: Pick<Formats, "dateFormat">,
  ): string => {
    const name = periodName(period, policy);
    return name.kind === "month"
      ? t("periodMonth", { month: t(`month.${name.month as 1}`), year: String(name.year) })
      : t("periodRange", { start: formatDate(name.start, formats), end: formatDate(name.end, formats) });
  };
};
