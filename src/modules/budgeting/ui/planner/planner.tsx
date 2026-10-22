"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Icon, ProblemNotice, ScreenHeader, usePeriodText } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { formatDate, formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { PlanStatusBadge } from "../plan-status-badge";
import { canCloseOn, canManage, closesFrom, isEditable } from "../plan-access";
import { ifMatch, planWrite, rereadPlan } from "../plan-write";

interface Failure {
  readonly problem: Problem;
  readonly lineIds: readonly string[];
}

/**
 * HU-E9-08, the Planner artboard (rulings P206 and P207): the plan's period and status, the capacity summary and the
 * lines, with the lifecycle of the plan (activate, then close from the day after its period). It keeps the plan each
 * write answers and sends the version it shows. Managers edit; a MEMBER reaches only their own capacity; a VIEWER and
 * every CLOSED plan read. A close refused with SourcePlanOpen (ruling P248) names the period to close first and links
 * to that plan, which this plan was copied from.
 */
export function Planner({
  space,
  plan: initial,
  members,
  formats,
  today,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Formats;
  readonly today: string;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting");
  const router = useRouter();
  const periodText = usePeriodText();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  const [plan, setPlan] = useState(initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const manager = canManage(space.role);
  const editable = isEditable(plan);
  const base = `/spaces/${space.id}/plans/${plan.id}`;
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  const money = (value: { readonly amount: string; readonly currency: string }) =>
    formatMoney(value, formats);

  const lifecycle = async (action: "activate" | "close") => {
    // A second click can arrive before the re-render that disables the button.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const call = { params: { path: { spaceId: space.id, planId: plan.id } }, headers: ifMatch(plan) };
    const result = await planWrite(
      action === "activate"
        ? api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/activate", call)
        : api.POST("/api/v1/spaces/{spaceId}/plans/{planId}/close", call),
    );
    if (result.ok) {
      setPlan(result.plan);
      setFailure(null);
      router.refresh();
    } else {
      setFailure({ problem: result.problem, lineIds: result.lineIds });
      if (result.problem.code === "PreconditionFailed") {
        const fresh = await rereadPlan(api, space.id, plan.id);
        if (fresh !== null) setPlan(fresh);
      }
    }
    inFlight.current = false;
    setPending(false);
  };

  const detail = () => {
    if (failure === null) return undefined;
    const { problem, lineIds } = failure;
    if (problem.code === "InvalidAllocation") {
      const lines = plan.lines.filter((line) => lineIds.includes(line.id)).map((line) => line.name);
      return lines.length > 0 ? t("planner.invalidLines", { lines: lines.join(", ") }) : undefined;
    }
    if (problem.code === "SourcePlanOpen" && plan.createdFrom !== null && problem.sourcePeriod !== undefined)
      return (
        <Button asChild variant="secondary" size="compact" className="mt-2">
          <Link href={`/spaces/${space.id}/plans/${plan.createdFrom}`}>
            {t("planner.goToSource", { period: problem.sourcePeriod })}
          </Link>
        </Button>
      );
    return undefined;
  };

  const heading = (key: string) => `${ids}-${key}`;
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
      <ScreenHeader
        backHref={`/spaces/${space.id}/plan?period=${plan.period.label}`}
        title={t("planner.title", { period: periodText(plan.period, space.periodPolicy, formats) })}
        subtitle={t("planner.dates", {
          space: space.name,
          start: formatDate(plan.period.startDate, formats),
          end: formatDate(plan.period.endDate, formats),
        })}
        action={<PlanStatusBadge status={plan.status} />}
      />
      {!editable ? (
        <p role="status" className="text-sm text-muted">
          {t("planner.closedNotice")}
        </p>
      ) : null}
      {failure !== null ? <ProblemNotice problem={failure.problem} detail={detail()} /> : null}

      <section aria-labelledby={heading("capacity")} className="flex flex-col gap-1 tabular-nums">
        <h2 id={heading("capacity")} className="text-base font-semibold text-ink">
          {t("planner.capacity")}
        </h2>
        <p className="text-2xl font-semibold [overflow-wrap:anywhere] text-ink">
          {money(plan.totalCapacity)}
        </p>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">
          {t("planner.unallocated", { amount: money(plan.unallocated) })}
        </p>
        {plan.capacities.map((capacity) => {
          const name = names.get(capacity.memberId) ?? "—";
          return (
            <p key={capacity.memberId} className="text-sm [overflow-wrap:anywhere] text-ink">
              {capacity.share === null
                ? t("planner.memberAmount", { name, amount: money(capacity.amount) })
                : t("planner.memberShare", {
                    name,
                    amount: money(capacity.amount),
                    share: formatPercent(capacity.share, formats),
                  })}
            </p>
          );
        })}
        {editable && (manager || space.role === "MEMBER") ? (
          <Button asChild variant="secondary" size="compact" className="mt-2 self-start">
            <Link href={`${base}/capacities`}>
              <Icon name="pencil" size={16} />
              {t("planner.editCapacities")}
            </Link>
          </Button>
        ) : null}
      </section>

      <section aria-labelledby={heading("lines")} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id={heading("lines")} className="text-base font-semibold text-ink">
            {t("planner.lines")}
          </h2>
          {manager && editable ? (
            <Button asChild variant="secondary" size="compact">
              <Link href={`${base}/lines/new`}>
                <Icon name="plus" size={16} />
                {t("planner.addLine")}
              </Link>
            </Button>
          ) : null}
        </div>
        {plan.lines.length === 0 ? (
          <p className="text-sm text-muted">{t("planner.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.lines.map((line) => (
              <li
                key={line.id}
                aria-labelledby={heading(line.id)}
                className="flex items-start gap-2 rounded-xl border border-line bg-surface p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span id={heading(line.id)} className="font-medium [overflow-wrap:anywhere] text-ink">
                      {line.name}
                    </span>
                    {line.isCatchAll ? <Badge>{t("line.catchAll")}</Badge> : null}
                    {line.allocation.error !== null ? (
                      <Badge tone="owe" icon="alert">
                        {t("planner.invalidAllocation")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted">
                    {t("planner.meta", {
                      funding: t(`funding.${line.funding}`),
                      rule: t(`rule.${line.allocation.rule}`),
                      rollover: t(`rollover.${line.rolloverMode}`),
                    })}
                  </p>
                  <p className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                    <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                      {money(line.plannedAmount)}
                    </span>
                    {line.capacityShare !== null ? (
                      <span className="text-sm text-muted">
                        {t("planner.ofCapacity", { share: formatPercent(line.capacityShare, formats) })}
                      </span>
                    ) : null}
                  </p>
                </div>
                {manager && editable ? (
                  <Button asChild variant="ghost" size="iconCompact" className="-mt-1 -mr-1 shrink-0">
                    <Link
                      href={`${base}/lines/${line.id}`}
                      aria-label={t("planner.editLine", { name: line.name })}
                    >
                      <Icon name="pencil" size={18} />
                    </Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {manager && plan.status === "DRAFT" ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" disabled={pending} onClick={() => void lifecycle("activate")}>
            {t("planner.activate")}
          </Button>
          <p className="text-sm text-muted">{t("planner.activateHint")}</p>
        </div>
      ) : null}
      {manager && plan.status === "ACTIVE" ? (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="secondary"
            disabled={pending || !canCloseOn(plan, today)}
            onClick={() => void lifecycle("close")}
          >
            {t("planner.close")}
          </Button>
          <p className="text-sm text-muted">
            {t("planner.closeHint", { date: formatDate(closesFrom(plan), formats) })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
