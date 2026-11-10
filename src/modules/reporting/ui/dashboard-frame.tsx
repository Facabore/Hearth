import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { canManage, PlanStatusBadge } from "@/modules/budgeting/ui";
import { Button, Icon, ScreenHeader, usePeriodText, VisuallyHidden } from "@/shared/ui";
import type { PeriodDto, ReportPlanDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { useNamesText } from "./origin";
import { PlanTabs } from "./plan-tabs";
import { viewHref, type PlanView } from "./views";

const BOX = "flex size-11 shrink-0 items-center justify-center rounded-full text-ink";

/**
 * Ruling P272 (the E9-10 boards): what the line under the period says. A shared space's views name the space, the
 * Members view with the plan's status, the line trend with what it compares against and the Fondo view with the fund
 * it tracks (#240, board E9-10 04); Rubros wears the status as a badge beside the period instead, and the personal
 * space's views say nothing more.
 */
const useSubtitle = () => {
  const t = useTranslations("reports.frame");
  const namesText = useNamesText();
  return (
    space: SpaceDto,
    view: PlanView,
    plan: ReportPlanDto | null,
    fundNames: readonly string[],
  ): string | null => {
    if (space.kind === "PERSONAL" || view === "lines") return null;
    if (view === "members" && plan)
      return t("subtitle", { space: space.name, detail: t(`plan.${plan.status}`) });
    if (view === "trend") return t("subtitle", { space: space.name, detail: t("againstPrevious") });
    if (view === "fund" && fundNames.length > 0)
      return t("subtitle", { space: space.name, detail: namesText(fundNames) });
    return space.name;
  };
};

/**
 * The frame every dashboard of the Plan tab shares (ruling P200), as the E9-10 boards draw it (P272): the period as
 * the heading between its neighbours with a line of context under it, the plan's status beside it and the link to the
 * planner on Rubros, and the view tabs. Ruling P311 (amends P200): Plan left the bar, so the frame is a stacked screen
 * titled Plan whose way back is the space's Configuración, where Plan del mes opens it. A shared space's line trend is read up to its period ("Hasta noviembre 2026").
 */
export function DashboardFrame({
  space,
  view,
  period,
  previous,
  next,
  formats,
  plan,
  wide = false,
  fundNames = [],
  children,
}: {
  readonly space: SpaceDto;
  readonly view: PlanView;
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly formats: Pick<Formats, "dateFormat">;
  readonly plan: ReportPlanDto | null;
  /** From 1024 px the frame takes the DashDesktop artboard's width, for the desktop overview's two columns (P216). */
  readonly wide?: boolean;
  /** #240: the fund accounts the Fondo view tracks, named after the space; none from an older API. */
  readonly fundNames?: readonly string[];
  readonly children: ReactNode;
}) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const periodText = usePeriodText();
  const subtitle = useSubtitle()(space, view, plan, fundNames);
  const name = periodText(period, space.periodPolicy, formats);
  const title = view === "trend" && space.kind !== "PERSONAL" ? t("frame.upTo", { period: name }) : name;
  const lines = view === "lines" ? plan : null;
  const previousHref = previous ? viewHref(space, view, previous.label) : null;
  const nextHref = next ? viewHref(space, view, next.label) : null;
  return (
    <div
      className={`mx-auto flex w-full max-w-[720px] flex-col gap-3 py-3${wide ? " lg:max-w-[1220px]" : ""}`}
    >
      <ScreenHeader backHref={`/spaces/${space.id}/settings`} title={t("title")} />
      <div className="flex flex-col gap-1">
        {lines ? (
          <Button asChild variant="secondary" size="compact" className="self-end">
            <Link href={`/spaces/${space.id}/plans/${lines.id}`}>
              <Icon name="pencil" size={16} />
              {canManage(space.role) ? t("frame.editPlan") : t("frame.viewPlan")}
            </Link>
          </Button>
        ) : null}
        <div className="flex items-center justify-between gap-1">
          {previousHref === null ? (
            <span className="size-11 shrink-0" />
          ) : (
            <Link href={previousHref} replace className={BOX}>
              <Icon name="back" />
              <VisuallyHidden>{tc("previousPeriod")}</VisuallyHidden>
            </Link>
          )}
          <div className="flex min-w-0 flex-col items-center text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <h2 className="text-lg font-semibold text-ink first-letter:uppercase [overflow-wrap:anywhere]">
                {title}
              </h2>
              {lines ? <PlanStatusBadge status={lines.status} /> : null}
            </div>
            {subtitle ? (
              <p data-frame-subtitle className="text-sm text-muted [overflow-wrap:anywhere]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {nextHref === null ? (
            <span className="size-11 shrink-0" />
          ) : (
            <Link href={nextHref} replace className={BOX}>
              <Icon name="chevronRight" />
              <VisuallyHidden>{tc("nextPeriod")}</VisuallyHidden>
            </Link>
          )}
        </div>
      </div>
      <PlanTabs space={space} view={view} period={period.label} />
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
