"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { Button, Icon, NumberField, ProblemNotice, Sheet, usePeriodText } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CapacitySuggestionDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { Amount, AmountText } from "@/shared/ui/atoms/amount";
import { HeroAmount } from "@/shared/ui/atoms/hero-amount";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { currencyOf } from "@/shared/ui/format/currencies";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import {
  decimalOf,
  formatMoney,
  formatNumber,
  formatPercent,
  type Formats,
} from "@/shared/ui/format/formatters";
import { capacityEditable, isEditable, takesPart } from "../plan-access";
import { ifMatch, planWrite, rereadPlan } from "../plan-write";
import {
  capacityBodyOf,
  capacityFieldOf,
  draftsOf,
  otherDraftsOf,
  otherKey,
  type OtherDraft,
} from "./capacity-draft";

const OtherContributions = dynamic(
  () => import("./per-currency").then((module) => module.OtherContributions),
  { ssr: false },
);

/** Every currency loads with the sheet, on the first tap, never with the planner (ADR 0004). */
const CurrencySheet = dynamic(
  () => import("@/shared/ui/molecules/currency-sheet").then((module) => module.CurrencySheet),
  { ssr: false },
);

/** Where the last attempt failed: a member's field (unreadable text, or a refused amount) or the form. */
type Failure =
  | { readonly field: string; readonly unreadable: true }
  | { readonly field: string; readonly unreadable: false; readonly problem: Problem };

/**
 * HU-E9-08, the Capacity artboard (rulings P206 to P208, D17): what each member puts into the plan. Managers edit
 * every row, a MEMBER only their own, a VIEWER and a CLOSED plan read; a VIEWER member who holds no capacity has no
 * row (#217). The viewer's own row may carry their private
 * suggestion, which fills the field and saves nothing. The total and the shares are the stored ones until the save
 * answers, never a sum of the fields.
 */
export function CapacityForm({
  space,
  plan: initial,
  members: everyone,
  viewerUserId,
  suggestion,
  formats,
  favorites = [],
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  readonly members: readonly SpaceMemberDto[];
  readonly viewerUserId: string;
  /** The viewer's own suggestion, or null: the container never hands over anyone else's (ruling P208). */
  readonly suggestion: CapacitySuggestionDto | null;
  readonly formats: Formats;
  /** Ruling P342 (S2): the person's favorite currencies, which the currency sheet lists after the space's. */
  readonly favorites?: readonly string[];
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting");
  const router = useRouter();
  const planner = `/spaces/${space.id}/plans/${initial.id}`;
  const periodText = usePeriodText();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  // #217: a viewer who holds no capacity has no row, so a save never writes one for them.
  const members = useMemo(() => everyone.filter((member) => takesPart(initial, member)), [everyone, initial]);
  const [plan, setPlan] = useState(initial);
  const [drafts, setDrafts] = useState(() => draftsOf(initial, members, formats));
  // Ruling P342 (S7): each member's contributions in other currencies, and the member choosing one to add.
  const [others, setOthers] = useState(() => otherDraftsOf(initial, members, formats));
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  const [sheetLoaded, setSheetLoaded] = useState(false);
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
    // P342 (ADR 0004): contributions in other currencies are read with the code that drew their fields.
    const stored = otherDraftsOf(plan, members, formats);
    const any = (fields: Record<string, readonly OtherDraft[]>) =>
      Object.values(fields).some((f) => f.length > 0);
    inFlight.current = true;
    const extra =
      any(others) || any(stored)
        ? (await import("./per-currency")).otherCapacitiesOf(
            others,
            stored,
            editableIds,
            formats.numberFormat,
          )
        : { ok: true as const, rows: [] };
    inFlight.current = false;
    if (!extra.ok) {
      setFailure({ field: otherKey(extra.memberId, extra.currency), unreadable: true });
      return;
    }
    const sentIds = [...editableIds, ...extra.rows.map((row) => otherKey(row.memberId, row.amount.currency))];
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    const result = await planWrite(
      api.PUT("/api/v1/spaces/{spaceId}/plans/{planId}/capacities", {
        params: { path: { spaceId: space.id, planId: plan.id } },
        headers: ifMatch(plan),
        body: { capacities: [...built.body.capacities, ...extra.rows] },
      }),
    );
    if (result.ok) {
      setPlan(result.plan);
      // P303: the sheet leaves without a history entry, so Volver on the planner never reopens it.
      leaveSheet(router, planner, () => router.refresh());
    } else if (result.problem.code === "PreconditionFailed") {
      // Ruling P206: the message stays, and the fields start again from what the server has now.
      setFormProblem(result.problem);
      const fresh = await rereadPlan(api, space.id, plan.id);
      if (fresh !== null) {
        setPlan(fresh);
        setDrafts(draftsOf(fresh, members, formats));
        setOthers(otherDraftsOf(fresh, members, formats));
      }
    } else {
      const field = capacityFieldOf(result.problem, sentIds);
      if (field === "form") setFormProblem(result.problem);
      else setFailure({ field, unreadable: false, problem: result.problem });
    }
    inFlight.current = false;
    setPending(false);
  };

  const errorOf = (field: string) => {
    if (failure === null || failure.field !== field) return undefined;
    return failure.unreadable
      ? t("capacity.unreadable", { example: formatNumber("1500000", formats) })
      : messageOf(failure.problem).message;
  };

  return (
    <Sheet
      open
      // Ruling P307: the sheet has an address of its own (P189), which Back already leaves.
      historyEntry={false}
      onOpenChange={(open) => {
        if (!open) leaveSheet(router, planner);
      }}
      title={t("capacity.title")}
      description={t("capacity.subtitle", { period: periodText(plan.period, space.periodPolicy, formats) })}
      footer={
        editableIds.length > 0 ? (
          <Button size="lg" disabled={pending} onClick={() => void save()}>
            {t("capacity.save")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-1">
        {members.map((member) => {
          const mine = member.userId === viewerUserId;
          const editable = mayEdit(member);
          const stored = plan.capacities.find((capacity) => capacity.memberId === member.id);
          const labelId = `${ids}-name-${member.id}`;
          const storedOthers = (plan.currencies ?? [])
            .slice(1)
            .flatMap(({ capacities }) =>
              capacities
                .filter((c) => c.memberId === member.id && BigInt(c.amount.amount) !== 0n)
                .map((c) => c.amount),
            );
          const suggested =
            suggestion?.suggested != null && suggestion.memberId === member.id && mine
              ? suggestion.suggested
              : null;
          return (
            <div key={member.id} role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
              <p id={labelId} className="font-semibold [overflow-wrap:anywhere] text-ink">
                {mine ? t("capacity.you", { name: member.displayName }) : member.displayName}
              </p>
              {editable ? (
                // Board 04: the member's name above is the field's visible label; "Aporte de Ana" names it to
                // assistive technology, and the large field carries no example.
                <div className="[&_label]:sr-only">
                  <NumberField
                    id={`${ids}-field-${member.id}`}
                    label={t("capacity.field", { name: member.displayName })}
                    kind="money"
                    numberFormat={formats.numberFormat}
                    decimals={exponent}
                    currency={currency}
                    example={false}
                    large
                    value={drafts[member.id] ?? ""}
                    onChange={(next) => {
                      setDrafts((current) => ({ ...current, [member.id]: next }));
                      if (failure?.field === member.id) setFailure(null);
                    }}
                    error={errorOf(member.id)}
                  />
                </div>
              ) : (
                <HeroAmount
                  amount={money(stored?.amount ?? zero)}
                  size="1.5rem"
                  className="leading-[1.333] font-semibold text-ink"
                />
              )}
              {/* P342: the fields of other currencies load only for a member who has one (ADR 0004). */}
              {(editable ? (others[member.id] ?? []).length : storedOthers.length) > 0 ? (
                <OtherContributions
                  idPrefix={`${ids}-field-${member.id}`}
                  name={member.displayName}
                  editable={editable}
                  stored={storedOthers}
                  drafts={others[member.id] ?? []}
                  formats={formats}
                  errorOf={(other) => errorOf(otherKey(member.id, other))}
                  onChange={(next) => {
                    setOthers((current) => ({ ...current, [member.id]: next }));
                    if (failure?.field.startsWith(`${member.id}:`)) setFailure(null);
                  }}
                />
              ) : null}
              {editable ? (
                <Button
                  variant="ghost"
                  size="compact"
                  className="-mx-2 self-start font-medium"
                  onClick={() => {
                    setSheetLoaded(true);
                    setChoosingFor(member.id);
                  }}
                >
                  <Icon name="plus" size={18} />
                  {t("capacity.addCurrency")}
                </Button>
              ) : null}
              {suggested !== null ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-accent-soft p-3 text-sm text-ink">
                  <p className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
                    <AmountText
                      text={t("capacity.suggestion", {
                        amount: money(suggested),
                        period: periodText(suggestion!.period, space.periodPolicy, formats),
                      })}
                    />
                  </p>
                  {editable ? (
                    <Button
                      variant="primary"
                      size="compact"
                      className="px-4"
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

        <p className="text-sm text-muted">
          <span>{t("capacity.zeroNote", { zero: money(zero) })}</span> <span>{t("capacity.rolesNote")}</span>
        </p>

        {/* Board 04: one tinted bar, the stored total on the left and each member's stored share on the right. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl bg-track px-4 py-3 text-sm text-ink tabular-nums">
          <p className="[overflow-wrap:anywhere]">
            {t("capacity.total")}{" "}
            <Amount as="strong" className="font-semibold">
              {money(plan.totalCapacity)}
            </Amount>
          </p>
          <p className="[overflow-wrap:anywhere] text-muted">
            <AmountText
              text={plan.capacities
                .map((capacity) => {
                  const name = names.get(capacity.memberId) ?? "—";
                  return capacity.share === null
                    ? t("planner.memberAmount", { name, amount: money(capacity.amount) })
                    : t("capacity.memberShare", { name, share: formatPercent(capacity.share, formats) });
                })
                .join(" · ")}
            />
          </p>
        </div>

        {formProblem !== null ? <ProblemNotice problem={formProblem} /> : null}
      </div>
      {sheetLoaded ? (
        <CurrencySheet
          open={choosingFor !== null}
          onOpenChange={(open) => {
            if (!open) setChoosingFor(null);
          }}
          title={t("capacity.currencyTitle")}
          value={currency}
          primary={currency}
          favorites={favorites}
          onChoose={(code) => {
            const memberId = choosingFor;
            if (memberId === null || code === currency) return;
            setOthers((current) => {
              const fields = current[memberId] ?? [];
              return fields.some((field) => field.currency === code)
                ? current
                : { ...current, [memberId]: [...fields, { currency: code, text: "" }] };
            });
          }}
        />
      ) : null}
    </Sheet>
  );
}
