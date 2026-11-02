import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { canManage, PlanStatusBadge } from "@/modules/budgeting/ui";
import { Button, Icon, usePeriodText, VisuallyHidden } from "@/shared/ui";
import type { PeriodDto, ReportPlanDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { PlanTabs } from "./plan-tabs";
import { viewHref, type PlanView } from "./views";

const BOX = "flex size-11 shrink-0 items-center justify-center rounded-full text-ink";

/**
 * Ruling P272 (the E9-10 boards): what the line under the period says. A shared space's views name the space, the
 * Members view with the plan's status and the line trend with what it compares against; Rubros wears the status as a
 * badge beside the period instead, and the personal space's views say nothing more.
 */
const useSubtitle = () => {
  const t = useTranslations("reports.frame");
  return (space: SpaceDto, view: PlanView, plan: ReportPlanDto | null): string | null => {
    if (space.kind === "PERSONAL" || view === "lines") return null;
    if (view === "members" && plan)
      return t("subtitle", { space: space.name, detail: t(`plan.${plan.status}`) });
    if (view === "trend") return t("subtitle", { space: space.name, detail: t("againstPrevious") });
    return space.name;
  };
};

/**
 * The frame every dashboard of the Plan tab shares (ruling P200), as the E9-10 boards draw it (P272): the period as
 * the heading between its neighbours with a line of context under it, the plan's status beside it and the link to the
 * planner on Rubros, and the view tabs. It is the tab's root screen: the bottom navigation leads here, so it has no
 * Volver of its own. A shared space's line trend is read up to its period ("Hasta noviembre 2026").
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
  readonly children: ReactNode;
}) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const periodText = usePeriodText();
  const subtitle = useSubtitle()(space, view, plan);
  const name = periodText(period, space.periodPolicy, formats);
  const title = view === "trend" && space.kind !== "PERSONAL" ? t("frame.upTo", { period: name }) : name;
  const lines = view === "lines" ? plan : null;
  const previousHref = previous ? viewHref(space, view, previous.label) : null;
  const nextHref = next ? viewHref(space, view, next.label) : null;
  return (
    <div
      className={`mx-auto flex w-full max-w-[720px] flex-col gap-3 py-4${wide ? " lg:max-w-[1220px]" : ""}`}
    >
      <header className="flex flex-col gap-1">
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
            <Link href={previousHref} className={BOX}>
              <Icon name="back" />
              <VisuallyHidden>{tc("previousPeriod")}</VisuallyHidden>
            </Link>
          )}
          <div className="flex min-w-0 flex-col items-center text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <h1 className="text-lg font-semibold text-ink first-letter:uppercase [overflow-wrap:anywhere]">
                {title}
              </h1>
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
            <Link href={nextHref} className={BOX}>
              <Icon name="chevronRight" />
              <VisuallyHidden>{tc("nextPeriod")}</VisuallyHidden>
            </Link>
          )}
        </div>
      </header>
      <PlanTabs space={space} view={view} period={period.label} />
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
