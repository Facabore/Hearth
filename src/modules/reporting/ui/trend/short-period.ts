import { useTranslations } from "next-intl";
import { usePeriodText } from "@/shared/ui";
import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";

/**
 * The E9-11 boards (ruling P272) name a calendar month short: "nov" on its own and "nov 2026" with its year. Any other
 * period keeps its two dates (ruling P205), for both.
 */
export const useShortPeriod = () => {
  const t = useTranslations("common");
  const periodText = usePeriodText();
  return (
    period: PeriodDto,
    policy: SpaceDto["periodPolicy"],
    formats: Pick<Formats, "dateFormat">,
  ): { readonly month: string; readonly name: string } => {
    const name = periodName(period, policy);
    if (name.kind !== "month") {
      const full = periodText(period, policy, formats);
      return { month: full, name: full };
    }
    const month = t(`monthShort.${name.month as 1}`);
    return { month, name: t("periodMonth", { month, year: String(name.year) }) };
  };
};
