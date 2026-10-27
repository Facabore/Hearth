import { useTranslations } from "next-intl";
import { canManage, PlanStartActions } from "@/modules/budgeting/ui";
import { Icon, usePeriodText } from "@/shared/ui";
import type { LineDashboardDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { LineDashboard } from "./line-dashboard";

/**
 * HU-E9-10 (the NoPlan artboard): a period with no plan says so, offers managers to create or copy one (ruling P207),
 * and still shows what was spent, all of it Unbudgeted.
 */
export function NoPlan({
  space,
  dashboard,
  formats,
}: {
  readonly space: SpaceDto;
  readonly dashboard: LineDashboardDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.noPlan");
  const periodText = usePeriodText();
  return (
    <>
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
        <Icon name="calendar" size={24} />
        <h2 className="text-base font-semibold text-ink [overflow-wrap:anywhere]">
          {t("title", { period: periodText(dashboard.period, space.periodPolicy, formats) })}
        </h2>
        <p className="text-sm text-muted">{t("body")}</p>
        {canManage(space.role) ? (
          <PlanStartActions spaceId={space.id} period={dashboard.period.label} />
        ) : (
          <p className="text-sm text-muted">{t("managersOnly")}</p>
        )}
      </section>
      <LineDashboard dashboard={dashboard} policy={space.periodPolicy} formats={formats} />
    </>
  );
}
