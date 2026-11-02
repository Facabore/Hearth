import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatPercent, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";

export type ChangeStatus = "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED";

/**
 * Ruling P219: a change's amount with its sign, and its percentage when the API could answer one ("−$ 50.000
 * (−3,70 %)"). Both are the API's (ruling P201).
 */
export const changeFigure = (
  change: MoneyDto | null,
  changePercent: string | null,
  formats: Pick<Formats, "numberFormat">,
): string =>
  `${change ? formatSignedMoney(change, formats) : ""}${
    changePercent !== null ? ` (${formatPercent(changePercent, formats, { signed: true })})` : ""
  }`.trim();

/** Ruling P219: where a change goes, in a word and an arrow, so its direction never relies on color alone. */
export function ChangeBadge({
  changeStatus,
  increaseIsBad = true,
}: {
  readonly changeStatus: ChangeStatus;
  readonly increaseIsBad?: boolean;
}) {
  const t = useTranslations("reports.trend");
  if (changeStatus === "NEW") return <Badge icon="plus">{t("new")}</Badge>;
  if (changeStatus === "INCREASED")
    return (
      <Badge icon="arrowUp" tone={increaseIsBad ? "owe" : "neutral"}>
        {t("increased")}
      </Badge>
    );
  if (changeStatus === "DECREASED")
    return (
      <Badge icon="arrowDown" tone="accent">
        {t("decreased")}
      </Badge>
    );
  return <Badge>{t("unchanged")}</Badge>;
}

/**
 * Ruling P219: a period's change against the one before, written once for the views that show it with its badge. A
 * percentage too large for the API to answer is left out, and a period with nothing before it wears the New badge
 * instead of a figure.
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
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {changeStatus === "NEW" ? (
        <>
          <ChangeBadge changeStatus="NEW" />
          <span className="text-muted">{t("noPrevious")}</span>
        </>
      ) : (
        <>
          <span className="tabular-nums">{changeFigure(change, changePercent, formats)}</span>
          <ChangeBadge changeStatus={changeStatus} increaseIsBad={increaseIsBad} />
        </>
      )}
    </span>
  );
}
