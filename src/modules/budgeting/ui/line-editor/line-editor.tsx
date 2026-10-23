"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ChoiceGroup,
  Icon,
  ProblemNotice,
  ScreenHeader,
  Sheet,
  Switch,
  TextField,
} from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, BudgetPlanDto, PlanLineDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatMoney, formatNumber, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { rereadPlan } from "../plan-write";
import {
  lineBodyOf,
  lineChanges,
  lineDraftOf,
  lineFieldOf,
  type Funding,
  type LineDraft,
  type LineField,
  type RolloverMode,
} from "./line-draft";
import { removeLine, saveLine } from "./line-save";

const FUNDINGS: readonly Funding[] = ["DIRECT", "SHARED_FUND", "SAVINGS"];
const ROLLOVERS: readonly RolloverMode[] = ["RESET", "ROLLOVER", "ADJUSTED"];

/** A field's message under it: the same icon and colour as a text field's error. */
function FieldError({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-danger">
      <Icon name="alert" size={16} />
      {children}
    </p>
  );
}

/**
 * HU-E9-08, the LineEditor artboard's upper half (rulings P210, P213): a line's name, planned amount, funding,
 * rollover and catch-all switch. An existing line also shows what was planned, spent and left, and can be removed
 * after a confirmation. Saving sends one request, the plan's `If-Match` with it, and keeps the plan it answers.
 */
export function LineEditor({
  space,
  plan: initial,
  line,
  savingsAccounts,
  formats,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  /** The line being edited, or null for a new one. */
  readonly line: PlanLineDto | null;
  /** The caller's own active SAVINGS accounts in the plan's currency (ruling P213). */
  readonly savingsAccounts: readonly AccountDto[];
  readonly formats: Formats;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting.lineEditor");
  const tFunding = useTranslations("budgeting.funding");
  const tRollover = useTranslations("budgeting.rollover");
  const tReports = useTranslations("reports.lines");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  const [plan, setPlan] = useState(initial);
  const [draft, setDraft] = useState<LineDraft>(() => lineDraftOf(line, formats));
  const [fieldError, setFieldError] = useState<{ field: LineField; text: string } | null>(null);
  const [formProblem, setFormProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inFlight = useRef(false);

  const currency = plan.totalCapacity.currency;
  const money = (value: { readonly amount: string; readonly currency: string }) =>
    formatMoney(value, formats);
  const back = `/spaces/${space.id}/plans/${plan.id}`;
  const savings = draft.funding === "SAVINGS";
  const ownIds = new Set(savingsAccounts.map((account) => account.id));
  const foreignIds = draft.savingsAccountIds.filter((id) => !ownIds.has(id));
  const errorOf = (field: LineField) => (fieldError?.field === field ? fieldError.text : undefined);
  const change = (patch: Partial<LineDraft>, field?: LineField) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (field !== undefined && fieldError?.field === field) setFieldError(null);
  };
  const toggleAccount = (id: string, on: boolean) =>
    change(
      {
        savingsAccountIds: on
          ? [...draft.savingsAccountIds, id]
          : draft.savingsAccountIds.filter((other) => other !== id),
      },
      "savings",
    );

  /** Ruling P206: the message stays, the plan is read again, and the draft is kept. */
  const conflict = async (problem: Problem) => {
    setFormProblem(problem);
    const fresh = await rereadPlan(api, space.id, plan.id);
    if (fresh !== null) setPlan(fresh);
  };

  const save = async () => {
    // A second submit can arrive before the re-render that disables the button.
    if (inFlight.current) return;
    setFormProblem(null);
    setFieldError(null);
    const built = lineBodyOf(draft, currency, formats.numberFormat);
    if (!built.ok) {
      setFieldError({
        field: built.field,
        text: t("unreadable", { example: formatNumber("1500000", formats) }),
      });
      return;
    }
    inFlight.current = true;
    setPending(true);
    const outcome = await saveLine(
      api,
      { spaceId: space.id, plan, lineId: line?.id ?? null },
      { line: line ? lineChanges(line, built.body) : built.body },
    );
    if (outcome.ok) {
      router.push(back);
      router.refresh();
    } else {
      setPlan(outcome.plan);
      if (outcome.problem.code === "PreconditionFailed") await conflict(outcome.problem);
      else {
        const field = lineFieldOf(outcome.problem);
        if (field === "form") setFormProblem(outcome.problem);
        else setFieldError({ field, text: messageOf(outcome.problem).message });
      }
    }
    inFlight.current = false;
    setPending(false);
  };

  const remove = async () => {
    if (inFlight.current || line === null) return;
    setFormProblem(null);
    inFlight.current = true;
    setPending(true);
    const result = await removeLine(api, { spaceId: space.id, plan, lineId: line.id });
    if (result.ok) {
      router.push(back);
      router.refresh();
    } else if (result.problem.code === "PreconditionFailed") await conflict(result.problem);
    else setFormProblem(result.problem);
    inFlight.current = false;
    setPending(false);
  };

  const name = errorOf("name");
  const planned = errorOf("planned");
  const savingsError = errorOf("savings");
  const catchAllError = errorOf("catchAll");

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
      <ScreenHeader backHref={back} title={line === null ? t("newTitle") : t("title", { name: line.name })} />

      {line !== null ? (
        <section aria-labelledby={`${ids}-figures`} className="rounded-xl border border-line bg-surface p-3">
          <h2 id={`${ids}-figures`} className="sr-only">
            {t("figures")}
          </h2>
          <dl className="grid grid-cols-3 gap-2 tabular-nums">
            {(
              [
                ["planned", line.plannedAmount],
                ["spent", line.spent],
                ["available", line.available],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex min-w-0 flex-col">
                <dt className="text-sm text-muted">{tReports(key)}</dt>
                <dd className="font-semibold [overflow-wrap:anywhere] text-ink">{money(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          id={`${ids}-name`}
          label={t("field.name")}
          autoComplete="off"
          value={draft.name}
          onChange={(event) => change({ name: event.target.value }, "name")}
          error={name}
        />
        <TextField
          id={`${ids}-planned`}
          label={t("field.planned")}
          inputMode="decimal"
          autoComplete="off"
          value={draft.planned}
          onChange={(event) => change({ planned: event.target.value }, "planned")}
          hint={
            line?.capacityShare != null
              ? t("field.plannedHint", {
                  share: formatPercent(line.capacityShare, formats),
                  unallocated: money(plan.unallocated),
                })
              : t("field.plannedNewHint", { unallocated: money(plan.unallocated) })
          }
          error={planned}
        />

        <ChoiceGroup
          label={t("field.funding")}
          value={draft.funding}
          options={FUNDINGS.map((value) => ({ value, label: tFunding(value) }))}
          onValueChange={(funding) => change({ funding })}
        />

        {savings ? (
          <fieldset
            aria-describedby={savingsError ? `${ids}-savings-error` : undefined}
            className="flex flex-col gap-1"
          >
            <legend className="mb-1 text-sm font-medium text-ink">{t("field.savingsAccounts")}</legend>
            {savingsAccounts.map((account) => (
              <label key={account.id} className="flex min-h-11 items-center gap-3 text-base text-ink">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-accent"
                  checked={draft.savingsAccountIds.includes(account.id)}
                  onChange={(event) => toggleAccount(account.id, event.target.checked)}
                />
                <span className="[overflow-wrap:anywhere]">{account.name}</span>
              </label>
            ))}
            {foreignIds.map((id) => (
              <label key={id} className="flex min-h-11 items-center gap-3 text-base text-ink">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-accent"
                  checked
                  onChange={(event) => toggleAccount(id, event.target.checked)}
                />
                <span>{t("field.otherAccount")}</span>
              </label>
            ))}
            {savingsAccounts.length === 0 && foreignIds.length === 0 ? (
              <p className="text-sm text-muted">{t("field.noSavingsAccounts", { currency })}</p>
            ) : null}
            {savingsError ? <FieldError id={`${ids}-savings-error`}>{savingsError}</FieldError> : null}
          </fieldset>
        ) : null}

        <ChoiceGroup
          label={t("field.rollover")}
          value={draft.rolloverMode}
          options={ROLLOVERS.map((value) => ({ value, label: tRollover(value) }))}
          onValueChange={(rolloverMode) => change({ rolloverMode })}
        />

        {!savings ? (
          <div className="flex flex-col gap-1">
            <Switch
              id={`${ids}-catch-all`}
              label={t("field.catchAll")}
              description={t("field.catchAllHint")}
              checked={draft.isCatchAll}
              onCheckedChange={(isCatchAll) => change({ isCatchAll }, "catchAll")}
            />
            {catchAllError ? <FieldError id={`${ids}-catch-all-error`}>{catchAllError}</FieldError> : null}
          </div>
        ) : null}

        {formProblem !== null && !removing ? <ProblemNotice problem={formProblem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {line === null ? t("add") : t("save")}
        </Button>
      </form>

      {line !== null ? (
        <>
          <Button
            variant="danger"
            size="lg"
            disabled={pending}
            onClick={() => {
              setFormProblem(null);
              setRemoving(true);
            }}
          >
            {t("remove.open")}
          </Button>
          <Sheet
            open={removing}
            onOpenChange={setRemoving}
            title={t("remove.title", { name: line.name })}
            description={t("remove.explain")}
            footer={
              <Button variant="danger" size="lg" disabled={pending} onClick={() => void remove()}>
                {t("remove.confirm")}
              </Button>
            }
          >
            {formProblem !== null ? <ProblemNotice problem={formProblem} /> : null}
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
