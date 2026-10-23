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
import type {
  AccountDto,
  BudgetPlanDto,
  CategoryGroupDto,
  PlanLineDto,
  SpaceDto,
  SpaceMemberDto,
} from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { findCategory } from "@/modules/categories/ui";
import { CarryText } from "../carry-text";
import { rereadPlan } from "../plan-write";
import { AllocationEditor } from "./allocation-editor";
import {
  allocationBodyOf,
  allocationChanged,
  allocationDraftOf,
  previewOf,
  type AllocationDraft,
} from "./allocation";
import { CategoryMappingSheet } from "./category-mapping-sheet";
import {
  lineBodyOf,
  lineChanges,
  lineDraftOf,
  lineFieldOf,
  sameSet,
  type Funding,
  type LineDraft,
  type LineField,
  type RolloverMode,
} from "./line-draft";
import { removeLine, saveLine, type LineSection } from "./line-save";

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
 * HU-E9-08, the LineEditor artboard (rulings P210 to P213): a line's name, planned amount, funding, rollover and
 * catch-all switch, then its categories and who answers for it (the allocation, with its preview). An existing line
 * also shows what was planned, spent and left, and can be removed after a confirmation. Saving sends the steps that
 * have something to send, in order, each with the `If-Match` of the plan the step before answered.
 */
export function LineEditor({
  space,
  plan: initial,
  line,
  savingsAccounts,
  groups,
  members,
  formats,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  /** The line being edited, or null for a new one. */
  readonly line: PlanLineDto | null;
  /** The caller's own active SAVINGS accounts in the plan's currency (ruling P213). */
  readonly savingsAccounts: readonly AccountDto[];
  /** The space's live category groups, for the mapping sheet (ruling P212). */
  readonly groups: readonly CategoryGroupDto[];
  /** The space's members in join order, one allocation row each. */
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Formats;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting.lineEditor");
  const tFunding = useTranslations("budgeting.funding");
  const tRollover = useTranslations("budgeting.rollover");
  const tReports = useTranslations("reports.lines");
  const tMapping = useTranslations("budgeting.mapping");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  const [plan, setPlan] = useState(initial);
  const [draft, setDraft] = useState<LineDraft>(() => lineDraftOf(line, formats));
  const [categoryIds, setCategoryIds] = useState<readonly string[]>(() => line?.categoryIds ?? []);
  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft>(() =>
    allocationDraftOf(line, formats),
  );
  const [mapping, setMapping] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: LineField; text: string } | null>(null);
  const [sectionError, setSectionError] = useState<{ section: LineSection; text: string } | null>(null);
  const [formProblem, setFormProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState(false);
  /**
   * The line as the last answer has it, which a save compares the draft with. A step that fails after the line was
   * saved updates it, so a retry edits a new line instead of adding it again.
   */
  const [stored, setStored] = useState<PlanLineDto | null>(line);
  const inFlight = useRef(false);
  const allocationSection = useRef<HTMLElement>(null);

  const currency = plan.totalCapacity.currency;
  const lineId = stored?.id ?? null;
  const plannedMinor = (() => {
    const decimal = parseDecimal(draft.planned, formats.numberFormat);
    return decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
  })();
  const plannedNow = { amount: plannedMinor ?? stored?.plannedAmount.amount ?? "0", currency };
  const preview = previewOf(allocationDraft, {
    planned: plannedNow.amount,
    currency,
    members: members.map((member) => ({
      memberId: member.id,
      capacity: plan.capacities.find((capacity) => capacity.memberId === member.id)?.amount.amount ?? "0",
    })),
    numberFormat: formats.numberFormat,
  });
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
    setSectionError(null);
    const built = lineBodyOf(draft, currency, formats.numberFormat);
    if (!built.ok) {
      setFieldError({
        field: built.field,
        text: t("unreadable", { example: formatNumber("1500000", formats) }),
      });
      return;
    }
    // The preview already shows why: a sum that does not hold, nobody with capacity, or a value nobody can read.
    if (preview.kind === "invalid" || preview.kind === "noCapacity" || preview.kind === "unreadable") {
      allocationSection.current?.focus();
      return;
    }
    const allocation = allocationBodyOf(
      allocationDraft,
      members.map((member) => member.id),
      currency,
      formats.numberFormat,
    );
    // A savings line takes no categories (ruling P212).
    const mapped = savings
      ? null
      : stored === null
        ? categoryIds.length > 0
          ? categoryIds
          : null
        : sameSet(categoryIds, stored.categoryIds)
          ? null
          : categoryIds;
    inFlight.current = true;
    setPending(true);
    const outcome = await saveLine(
      api,
      { spaceId: space.id, plan, lineId },
      {
        line: stored ? lineChanges(stored, built.body) : built.body,
        categoryIds: mapped,
        allocation: allocation !== null && allocationChanged(stored, allocation) ? allocation : null,
      },
    );
    if (outcome.ok) {
      router.push(back);
      router.refresh();
    } else {
      setPlan(outcome.plan);
      if (outcome.lineId !== null)
        setStored(outcome.plan.lines.find((other) => other.id === outcome.lineId) ?? stored);
      if (outcome.problem.code === "PreconditionFailed") await conflict(outcome.problem);
      else if (outcome.section !== "line")
        setSectionError({ section: outcome.section, text: messageOf(outcome.problem).message });
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
  const chosen = categoryIds.flatMap((id) => {
    const category = findCategory(groups, id)?.category;
    return category ? [category] : [];
  });
  const categoriesError = sectionError?.section === "categories" ? sectionError.text : undefined;
  const allocationError = sectionError?.section === "allocation" ? sectionError.text : undefined;

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
            {line.carryOverFrom ? (
              <div className="col-span-3 flex min-w-0 flex-col">
                <dt className="text-sm text-muted">{t("carryOver")}</dt>
                <dd>
                  <CarryText line={line} policy={space.periodPolicy} formats={formats} />
                </dd>
              </div>
            ) : null}
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

        <div className="flex flex-col gap-1.5">
          <ChoiceGroup
            label={t("field.rollover")}
            value={draft.rolloverMode}
            options={ROLLOVERS.map((value) => ({ value, label: tRollover(value) }))}
            onValueChange={(rolloverMode) => change({ rolloverMode })}
            describedBy="line-rollover-hint"
          />
          <p id="line-rollover-hint" className="text-sm text-muted">
            {tRollover(`hint.${draft.rolloverMode}`)}
            {draft.rolloverMode === "RESET" ? "" : ` ${tRollover("throughCopy")}`}
          </p>
        </div>

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

        {!savings ? (
          <div className="flex flex-col gap-2">
            <p id={`${ids}-categories`} className="text-sm font-medium text-ink">
              {tMapping("label")}
            </p>
            {chosen.length > 0 ? (
              <ul aria-labelledby={`${ids}-categories`} className="flex flex-wrap gap-2">
                {chosen.map((category) => (
                  <li
                    key={category.id}
                    className="rounded-full border border-line px-3 py-1 text-sm [overflow-wrap:anywhere] text-ink"
                  >
                    {category.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{tMapping("none")}</p>
            )}
            {categoriesError ? (
              <FieldError id={`${ids}-categories-error`}>{categoriesError}</FieldError>
            ) : null}
            <Button variant="secondary" onClick={() => setMapping(true)}>
              {tMapping("choose")}
            </Button>
          </div>
        ) : null}

        <AllocationEditor
          ref={allocationSection}
          draft={allocationDraft}
          onChange={(next) => {
            setAllocationDraft(next);
            setSectionError(null);
          }}
          preview={preview}
          members={members}
          formats={formats}
          currency={currency}
          planned={plannedNow}
        />
        {allocationError ? <FieldError id={`${ids}-allocation-error`}>{allocationError}</FieldError> : null}

        {formProblem !== null && !removing ? <ProblemNotice problem={formProblem} /> : null}
        <Button type="submit" size="lg" disabled={pending}>
          {line === null ? t("add") : t("save")}
        </Button>
      </form>

      <CategoryMappingSheet
        open={mapping}
        onOpenChange={setMapping}
        groups={groups}
        plan={plan}
        lineId={lineId}
        lineName={draft.name.trim() || (line?.name ?? t("newTitle"))}
        value={categoryIds}
        onChange={(next) => {
          setCategoryIds(next);
          setSectionError(null);
        }}
      />

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
