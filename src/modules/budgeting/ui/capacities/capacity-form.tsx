"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { Button, NumberField, ProblemNotice, ScreenHeader, usePeriodText } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CapacitySuggestionDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { currencyOf } from "@/shared/ui/format/currencies";
import {
  decimalOf,
  formatMoney,
  formatNumber,
  formatPercent,
  type Formats,
} from "@/shared/ui/format/formatters";
import { capacityEditable, isEditable } from "../plan-access";
import { ifMatch, planWrite, rereadPlan } from "../plan-write";
import { capacityBodyOf, capacityFieldOf, draftsOf } from "./capacity-draft";

/** Where the last attempt failed: a member's field (unreadable text, or a refused amount) or the form. */
type Failure =
  | { readonly field: string; readonly unreadable: true }
  | { readonly field: string; readonly unreadable: false; readonly problem: Problem };

/**
 * HU-E9-08, the Capacity artboard (rulings P206 to P208, D17): what each member puts into the plan. Managers edit
 * every row, a MEMBER only their own, a VIEWER and a CLOSED plan read. The viewer's own row may carry their private
 * suggestion, which fills the field and saves nothing. The total and the shares are the stored ones until the save
 * answers, never a sum of the fields.
 */
export function CapacityForm({
  space,
  plan: initial,
  members,
  viewerUserId,
  suggestion,
  formats,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  readonly members: readonly SpaceMemberDto[];
  readonly viewerUserId: string;
  /** The viewer's own suggestion, or null: the container never hands over anyone else's (ruling P208). */
  readonly suggestion: CapacitySuggestionDto | null;
  readonly formats: Formats;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting");
  const router = useRouter();
  const periodText = usePeriodText();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  const [plan, setPlan] = useState(initial);
  const [drafts, setDrafts] = useState(() => draftsOf(initial, members, formats));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [formProblem, setFormProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const currency = plan.totalCapacity.currency;
  const exponent = currencyOf(currency).exponent;
  const money = (value: { readonly amount: string; readonly currency: string }) =>
    formatMoney(value, formats);
  const zero = { amount: "0", currency };
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  const mayEdit = (member: SpaceMemberDto) =>
    isEditable(plan) && capacityEditable(space.role, member, viewerUserId);
  const editableIds = members.filter(mayEdit).map((member) => member.id);

  const save = async () => {
    // A second click can arrive before the re-render that disables the button.
    if (inFlight.current) return;
    setFormProblem(null);
    const built = capacityBodyOf(drafts, editableIds, currency, formats.numberFormat);
    if (!built.ok) {
      setFailure({ field: built.memberId, unreadable: true });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    const result = await planWrite(
      api.PUT("/api/v1/spaces/{spaceId}/plans/{planId}/capacities", {
        params: { path: { spaceId: space.id, planId: plan.id } },
        headers: ifMatch(plan),
        body: built.body,
      }),
    );
    if (result.ok) {
      setPlan(result.plan);
      router.push(`/spaces/${space.id}/plans/${plan.id}`);
      router.refresh();
    } else if (result.problem.code === "PreconditionFailed") {
      // Ruling P206: the message stays, and the fields start again from what the server has now.
      setFormProblem(result.problem);
      const fresh = await rereadPlan(api, space.id, plan.id);
      if (fresh !== null) {
        setPlan(fresh);
        setDrafts(draftsOf(fresh, members, formats));
      }
    } else {
      const field = capacityFieldOf(result.problem, editableIds);
      if (field === "form") setFormProblem(result.problem);
      else setFailure({ field, unreadable: false, problem: result.problem });
    }
    inFlight.current = false;
    setPending(false);
  };

  const errorOf = (member: SpaceMemberDto) => {
    if (failure === null || failure.field !== member.id) return undefined;
    return failure.unreadable
      ? t("capacity.unreadable", { example: formatNumber("1500000", formats) })
      : messageOf(failure.problem).message;
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
      <ScreenHeader
        backHref={`/spaces/${space.id}/plans/${plan.id}`}
        title={t("capacity.title")}
        subtitle={t("capacity.subtitle", { period: periodText(plan.period, space.periodPolicy, formats) })}
      />

      <div className="flex flex-col gap-3">
        {members.map((member) => {
          const mine = member.userId === viewerUserId;
          const editable = mayEdit(member);
          const stored = plan.capacities.find((capacity) => capacity.memberId === member.id);
          const labelId = `${ids}-name-${member.id}`;
          const suggested =
            suggestion?.suggested != null && suggestion.memberId === member.id && mine
              ? suggestion.suggested
              : null;
          return (
            <div
              key={member.id}
              role="group"
              aria-labelledby={labelId}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
            >
              <p id={labelId} className="font-medium [overflow-wrap:anywhere] text-ink">
                {mine ? t("capacity.you", { name: member.displayName }) : member.displayName}
              </p>
              {editable ? (
                <NumberField
                  id={`${ids}-field-${member.id}`}
                  label={t("capacity.field", { name: member.displayName })}
                  kind="money"
                  numberFormat={formats.numberFormat}
                  decimals={exponent}
                  symbol={currencyOf(currency).symbol}
                  value={drafts[member.id] ?? ""}
                  onChange={(next) => {
                    setDrafts((current) => ({ ...current, [member.id]: next }));
                    if (failure?.field === member.id) setFailure(null);
                  }}
                  error={errorOf(member)}
                />
              ) : (
                <p className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere] text-ink">
                  {money(stored?.amount ?? zero)}
                </p>
              )}
              {suggested !== null ? (
                <div className="flex flex-col items-start gap-2 text-sm text-muted">
                  <p className="[overflow-wrap:anywhere]">
                    {t("capacity.suggestion", {
                      amount: money(suggested),
                      period: periodText(suggestion!.period, space.periodPolicy, formats),
                    })}
                  </p>
                  {editable ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      onClick={() => {
                        setDrafts((current) => ({
                          ...current,
                          [member.id]: formatNumber(decimalOf(suggested.amount, exponent), formats),
                        }));
                        if (failure?.field === member.id) setFailure(null);
                      }}
                    >
                      {t("capacity.useSuggestion")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted">{t("capacity.zeroNote", { zero: money(zero) })}</p>
      <p className="text-sm text-muted">{t("capacity.rolesNote")}</p>

      <div className="flex flex-col gap-1 tabular-nums">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-base font-semibold text-ink">{t("capacity.total")}</span>
          <span className="text-2xl font-semibold [overflow-wrap:anywhere] text-ink">
            {money(plan.totalCapacity)}
          </span>
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
      </div>

      {formProblem !== null ? <ProblemNotice problem={formProblem} /> : null}
      {editableIds.length > 0 ? (
        <Button size="lg" disabled={pending} onClick={() => void save()}>
          {t("capacity.save")}
        </Button>
      ) : null}
    </div>
  );
}
