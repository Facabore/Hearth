import { useTranslations } from "next-intl";
import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";

/**
 * Boards 03, 08 and 09 of HU-E9-08 name a calendar month alone, inside a sentence ("los gastos fechados en
 * noviembre"); any other period keeps its two dates in the person's format.
 */
export const usePeriodWord = () => {
  const t = useTranslations("common");
  return (
    period: PeriodDto,
    policy: SpaceDto["periodPolicy"],
    formats: Pick<Formats, "dateFormat">,
  ): string => {
    const name = periodName(period, policy);
    return name.kind === "month"
      ? t(`month.${name.month as 1}`)
      : t("periodRange", { start: formatDate(name.start, formats), end: formatDate(name.end, formats) });
  };
};
