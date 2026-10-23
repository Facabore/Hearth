import { useTranslations } from "next-intl";
import { usePeriodText } from "@/shared/ui";
import type { PlanLineDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";

/**
 * #143, rulings P231 and P243: what a line carries from the previous period and where it comes from. A closed source
 * reads "+$ 170.000 de septiembre 2026"; a source that is not closed yet says which plan the line waits for, because
 * until then it carries nothing. The sign is part of the text, so the carry never relies on colour. Nothing without an
 * origin in the source (`carryOverFrom` null): no text at all.
 */
export function CarryText({
  line,
  policy,
  formats,
}: {
  readonly line: Pick<PlanLineDto, "carryOver" | "carryOverFrom">;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.lines");
  const periodText = usePeriodText();
  const { carryOverFrom } = line;
  if (carryOverFrom === null) return null;
  const period = periodText(carryOverFrom.period, policy, formats);
  return (
    <span className="text-sm text-muted [overflow-wrap:anywhere]">
      {carryOverFrom.closed
        ? t("carryOver", { amount: formatSignedMoney(line.carryOver, formats), period })
        : t("carryOverPending", { period })}
    </span>
  );
}
