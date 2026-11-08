import { useTranslations } from "next-intl";
import { canManage, PlanStartActions } from "@/modules/budgeting/ui";
import { Icon, usePeriodText } from "@/shared/ui";
import type { LineDashboardDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import { LineList } from "./line-dashboard";

/**
 * HU-E9-10 (the NoPlan artboard, board E9-10 02 under ruling P272): a period with no plan says so in a centred card,
 * offers managers to create or copy one (ruling P207) and tells them only they see that, and still shows what was
 * spent, all of it Unbudgeted, as one compact card. A calendar month is named by its month ("en enero"), any other
 * period as this one. Ruling P311: it speaks to the person in her own space and names a shared one; "Crear plan" leads,
 * and the copy is offered only from a previous period that has a plan, named by that period.
 */
export function NoPlan({
  space,
  dashboard,
  formats,
  previous,
}: {
  readonly space: SpaceDto;
  readonly dashboard: LineDashboardDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  /**
   * The previous period when it has a plan to copy, null when it has none, absent while not known, and `true` when it
   * could not be read: the copy is offered anyway, and the API refuses it with its own message if there is nothing (P311).
   */
  readonly previous?: PeriodDto | true | null | undefined;
}) {
  const t = useTranslations("reports.noPlan");
  const tc = useTranslations("common");
  const periodText = usePeriodText();
  const name = periodName(dashboard.period, space.periodPolicy);
  const period = name.kind === "month" ? tc(`month.${name.month as 1}`) : t("thisPeriod");
  const personal = space.kind === "PERSONAL";
  // The copy names the period it starts from as its own words: its month, else its dates.
  const wordsOf = (of: PeriodDto) => {
    const named = periodName(of, space.periodPolicy);
    return named.kind === "month"
      ? tc(`month.${named.month as 1}`)
      : periodText(of, space.periodPolicy, formats);
  };
  return (
    <>
      <section className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-track text-ink">
          <Icon name="calendar" size={24} />
        </span>
        <h2 className="text-base font-semibold text-ink first-letter:uppercase [overflow-wrap:anywhere]">
          {personal ? t("titlePersonal", { period }) : t("titleShared", { period, space: space.name })}
        </h2>
        <p className="text-sm text-muted">{personal ? t("bodyPersonal") : t("bodyShared")}</p>
        {canManage(space.role) ? (
          <div className="flex w-full flex-col gap-2">
            <PlanStartActions
              spaceId={space.id}
              period={dashboard.period.label}
              previous={previous && previous !== true ? wordsOf(previous) : previous}
            />
            <p className="text-xs text-muted">{t("managersSee")}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("managersOnly")}</p>
        )}
      </section>
      <LineList
        dashboard={dashboard}
        policy={space.periodPolicy}
        formats={formats}
        unbudgetedCaption={(spent) => t("spentIn", { spent, period })}
      />
    </>
  );
}
