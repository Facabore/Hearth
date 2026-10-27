import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { canManage, PlanStatusBadge } from "@/modules/budgeting/ui";
import { Button, Icon, PeriodSwitcher, usePeriodText } from "@/shared/ui";
import type { PeriodDto, ReportPlanDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { PlanTabs } from "./plan-tabs";
import { viewHref, type PlanView } from "./views";

/**
 * The frame every dashboard of the Plan tab shares (ruling P200): the space's name, the period as the heading between
 * its neighbours, the plan's status with a link to the planner, and the view tabs. It is the tab's root screen: the
 * bottom navigation leads here, so it has no Volver of its own.
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
  offerPlanStart = false,
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
  /**
   * The view knows the period has no plan (`plan` null means so) and leads a manager to the Lines view, where the
   * plan is created or copied. My spending, the personal space's own page, asks for it: it is where its Plan tab opens.
   */
  readonly offerPlanStart?: boolean;
  readonly children: ReactNode;
}) {
  const t = useTranslations("reports");
  const periodText = usePeriodText();
  return (
    <div
      className={`mx-auto flex w-full max-w-[720px] flex-col gap-3 py-4${wide ? " lg:max-w-[1220px]" : ""}`}
    >
      <header className="flex flex-col gap-1">
        <p className="text-sm break-words text-muted">{space.name}</p>
        <PeriodSwitcher
          title={periodText(period, space.periodPolicy, formats)}
          previousHref={previous ? viewHref(space, view, previous.label) : null}
          nextHref={next ? viewHref(space, view, next.label) : null}
        />
        {plan ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PlanStatusBadge status={plan.status} />
            <Button asChild variant="secondary" size="compact">
              <Link href={`/spaces/${space.id}/plans/${plan.id}`}>
                <Icon name="pencil" size={16} />
                {canManage(space.role) ? t("frame.editPlan") : t("frame.viewPlan")}
              </Link>
            </Button>
          </div>
        ) : offerPlanStart && canManage(space.role) ? (
          <div className="flex justify-end">
            <Button asChild variant="secondary" size="compact">
              <Link href={viewHref(space, "lines", period.label)}>
                <Icon name="plus" size={16} />
                {t("frame.startPlan")}
              </Link>
            </Button>
          </div>
        ) : null}
      </header>
      <PlanTabs space={space} view={view} period={period.label} />
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
