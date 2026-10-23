import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatPercent, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";

export type ChangeStatus = "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED";

/**
 * Ruling P219: a period's change against the one before, written once for both trend views. The amount and the
 * percentage are the API's (ruling P201); a percentage too large for the API to answer is left out, and a period with
 * nothing before it wears the New badge instead of a figure.
 */
export function ChangeText({
  change,
  changePercent,
  changeStatus,
  formats,
  increaseIsBad = true,
}: {
  readonly change: MoneyDto | null;
  readonly changePercent: string | null;
  readonly changeStatus: ChangeStatus | null;
  readonly formats: Pick<Formats, "numberFormat">;
  readonly increaseIsBad?: boolean;
}) {
  const t = useTranslations("reports.trend");
  if (changeStatus === null) return null;
  if (changeStatus === "NEW") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge icon="plus">{t("new")}</Badge>
        <span className="text-muted">{t("noPrevious")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tabular-nums">
        {change ? formatSignedMoney(change, formats) : null}
        {changePercent !== null ? ` (${formatPercent(changePercent, formats, { signed: true })})` : null}
      </span>
      {changeStatus === "INCREASED" ? (
        <Badge icon="arrowUp" tone={increaseIsBad ? "owe" : "neutral"}>
          {t("increased")}
        </Badge>
      ) : changeStatus === "DECREASED" ? (
        <Badge icon="arrowDown" tone="accent">
          {t("decreased")}
        </Badge>
      ) : (
        <Badge>{t("unchanged")}</Badge>
      )}
    </span>
  );
}
