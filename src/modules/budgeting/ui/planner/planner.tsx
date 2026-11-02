"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Icon, ProblemNotice, ScreenHeader, usePeriodText } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type {
  BudgetPlanDto,
  CategoryGroupDto,
  PlanLineDto,
  SpaceDto,
  SpaceMemberDto,
} from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  type Formats,
} from "@/shared/ui/format/formatters";
import { CarryText } from "../carry-text";
import { CopyNotice } from "../copy-notice";
import { allocationDraftOf, previewOf } from "../line-editor/allocation";
import { usePeriodWord } from "../period-word";
import { PlanStatusBadge } from "../plan-status-badge";
import { canCloseOn, canManage, closesFrom, isEditable, takesPart } from "../plan-access";
import { ifMatch, planWrite, rereadPlan } from "../plan-write";
import { CapacityCard } from "./capacity-card";
import { LifecycleConfirm, type LifecycleAction } from "./lifecycle-confirm";

interface Failure {
  readonly problem: Problem;
  readonly lineIds: readonly string[];
}

/** Board 02: what a stored allocation that does not hold adds up to, from the line's own values. */
const invalidSum = (line: PlanLineDto, formats: Formats): string | null => {
  const preview = previewOf(allocationDraftOf(line, formats), {
    planned: line.plannedAmount.amount,
    currency: line.plannedAmount.currency,
    members: line.allocation.members.map((member) => ({ memberId: member.memberId, capacity: "0" })),
    numberFormat: formats.numberFormat,
  });
  if (preview.kind !== "invalid") return null;
  return preview.unit === "percent"
    ? formatPercent(preview.sum, formats)
    : formatMoney({ amount: preview.sum, currency: line.plannedAmount.currency }, formats);
};

/**
 * HU-E9-08, the Planner artboard (rulings P206 and P207): the plan's period and status, the capacity card and the
 * lines, with the lifecycle of the plan (activate, then close from the day after its period), each confirmed first
 * (boards 08 and 09). It keeps the plan each write answers and sends the version it shows. Managers edit, and each
 * line's whole row leads to its editor; a MEMBER reaches only their own capacity; a VIEWER and every CLOSED plan read.
 * A close refused with SourcePlanOpen (ruling P248) names the period to close first and links to that plan, which
 * this plan was copied from.
 */
export function Planner({
  space,
  plan: initial,
  members,
  formats,
  groups,
  today,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  readonly members: readonly SpaceMemberDto[];
  /** The space's categories, archived ones included: the copy notice names what a copy left out (ruling P209). */
  readonly groups: CategoryGroupDto[];
  readonly formats: Formats;
  readonly today: string;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting");
  const router = useRouter();
  const periodText = usePeriodText();
  const periodWord = usePeriodWord();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  const [plan, setPlan] = useState(initial);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null);
  const inFlight = useRef(false);

  const manager = canManage(space.role);
  const editable = isEditable(plan);
  const base = `/spaces/${space.id}/plans/${plan.id}`;
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  // #217: a viewer's zero capacity is no capacity, so it is not listed; a former member's row stays.
  const listed = ({ memberId }: { readonly memberId: string }) => {
    const member = members.find((m) => m.id === memberId);
    return member === undefined || takesPart(plan, member);
  };
  const money = (value: { readonly amount: string; readonly currency: string }) =>
    formatMoney(value, formats);
  const word = periodWord(plan.period, space.periodPolicy, formats);

  const lifecycle = async (action: LifecycleAction) => {
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
    setConfirming(null);
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

  /** Board 01: a percentage split says its ratio ("Porcentaje 42 / 58"); every other rule says its name. */
  const ruleOf = (line: PlanLineDto) => {
    const { rule, members: shares } = line.allocation;
    const percents = shares.flatMap((share) => (share.percent === null ? [] : [share.percent]));
    return rule === "PERCENT" && percents.length > 0
      ? t("planner.percentRule", {
          ratio: percents.map((percent) => formatNumber(percent, formats)).join(" / "),
        })
      : t(`rule.${rule}`);
  };

  const heading = (key: string) => `${ids}-${key}`;
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-3">
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
      <CopyNotice plan={plan} groups={groups} />
      {!editable ? (
        <p role="status" className="rounded-xl bg-track px-4 py-3 text-sm [overflow-wrap:anywhere] text-ink">
          {t("planner.closedNotice", { period: word })}
        </p>
      ) : null}
      {failure !== null ? <ProblemNotice problem={failure.problem} detail={detail()} /> : null}

      <CapacityCard
        headingId={heading("capacity")}
        total={plan.totalCapacity}
        unallocated={plan.unallocated}
        rows={plan.capacities.filter(listed).map((capacity) => ({
          memberId: capacity.memberId,
          name: names.get(capacity.memberId) ?? "—",
          amount: capacity.amount,
          share: capacity.share,
        }))}
        formats={formats}
        action={
          editable && (manager || space.role === "MEMBER") ? (
            <Button asChild variant="ghost" size="compact" className="-mx-2 self-start font-medium">
              <Link href={`${base}/capacities`}>
                {t("planner.editCapacities")}
                <Icon name="chevronRight" size={18} />
              </Link>
            </Button>
          ) : null
        }
      />

      <section aria-labelledby={heading("lines")} className="flex flex-col gap-2">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 id={heading("lines")} className="text-base font-semibold text-ink">
            {t("planner.lines")}
          </h2>
          {manager && editable ? (
            <Button asChild variant="ghost" size="compact" className="-mr-2 font-medium">
              <Link href={`${base}/lines/new`}>
                <Icon name="plus" size={18} />
                {t("planner.addLine")}
              </Link>
            </Button>
          ) : null}
        </div>
        {plan.lines.length === 0 ? (
          <p className="text-sm text-muted">{t("planner.empty")}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {plan.lines.map((line) => {
              const sum = line.allocation.error === null ? null : invalidSum(line, formats);
              const name = (
                <span id={heading(line.id)} className="[overflow-wrap:anywhere]">
                  {line.name}
                </span>
              );
              return (
                <li
                  key={line.id}
                  aria-labelledby={heading(line.id)}
                  className="relative flex items-start gap-3 px-4 py-3 has-[a:focus-visible]:bg-accent-soft"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                      {manager && editable ? (
                        <Link
                          href={`${base}/lines/${line.id}`}
                          aria-label={t("planner.editLine", { name: line.name })}
                          className="after:absolute after:inset-0 after:content-['']"
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      {line.isCatchAll ? <Badge>{t("line.catchAll")}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted">
                      {t("planner.meta", {
                        funding: t(`funding.${line.funding}`),
                        rule: ruleOf(line),
                        rollover: t(`rollover.${line.rolloverMode}`),
                      })}
                    </p>
                    <CarryText line={line} policy={space.periodPolicy} formats={formats} />
                    {line.allocation.error !== null ? (
                      <p className="flex items-center gap-1 text-sm font-semibold text-danger">
                        <Icon name="alert" size={16} />
                        {sum === null
                          ? t("planner.invalidAllocation")
                          : t("planner.invalidAllocationSum", { sum })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-right tabular-nums">
                    <p className="text-lg font-semibold text-ink">{money(line.plannedAmount)}</p>
                    {line.capacityShare !== null ? (
                      <p className="text-sm text-muted">
                        {t("planner.ofCapacity", { share: formatPercent(line.capacityShare, formats) })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {manager && plan.status === "DRAFT" ? (
        <div className="flex flex-col gap-2">
          <Button size="lg" disabled={pending} onClick={() => setConfirming("activate")}>
            {t("planner.activate")}
          </Button>
          <p className="text-center text-sm text-muted">{t("planner.activateHint")}</p>
        </div>
      ) : null}
      {manager && plan.status === "ACTIVE" ? (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="secondary"
            disabled={pending || !canCloseOn(plan, today)}
            onClick={() => setConfirming("close")}
          >
            {t("planner.close")}
          </Button>
          <p className="text-center text-sm text-muted">
            {t("planner.closeHint", { date: formatDate(closesFrom(plan), formats) })}
          </p>
        </div>
      ) : null}
      <LifecycleConfirm
        action={confirming}
        period={word}
        pending={pending}
        onConfirm={(action) => void lifecycle(action)}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setConfirming(null);
        }}
      />
    </div>
  );
}
