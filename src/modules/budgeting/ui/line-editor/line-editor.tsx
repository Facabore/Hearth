"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ChoiceGroup,
  Icon,
  NumberField,
  ProblemNotice,
  ScreenHeader,
  Sheet,
  TextField,
} from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { Amount, AmountText } from "@/shared/ui/atoms/amount";
import type {
  AccountDto,
  BudgetPlanDto,
  CategoryGroupDto,
  MoneyDto,
  PlanLineDto,
  SpaceDto,
  SpaceMemberDto,
} from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import { periodName } from "@/shared/ui/time/period-name";
import { findCategory } from "@/modules/categories/ui";
import { CarryText } from "../carry-text";
import { usePeriodWord } from "../period-word";
import { takesPart } from "../plan-access";
import { rereadPlan } from "../plan-write";
import { AllocationEditor } from "./allocation-editor";
import {
  allocationBodyOf,
  allocationChanged,
  allocationDraftOf,
  fixedValuesOf,
  previewOf,
  type AllocationDraft,
} from "./allocation";
import { budgetRowsOf, type BudgetRow } from "./budget-draft";
import { BudgetFields } from "./budget-fields";
import {
  lineBodyOf,
  lineChanges,
  lineDraftOf,
  lineFieldOf,
  sameSet,
  type LineDraft,
  type LineField,
  type RolloverMode,
} from "./line-draft";
import { removeLine, saveLine, type LineSection } from "./line-save";
import { choiceFor, joinNames, namesOf, payerCandidates, payModeOf, type PayMode } from "./payers";

// Issue #182: the mapping sheet's code loads only when someone opens it, so the editor's first view carries less
// script and its LCP stays under the budget (the pattern of P177).
const CategoryMappingSheet = dynamic(
  () => import("./category-mapping-sheet").then((module) => module.CategoryMappingSheet),
  { ssr: false },
);

// P342 (ADR 0004): each currency's allocation loads only for a line in several currencies.
const OtherAllocations = dynamic(() => import("./per-currency").then((module) => module.OtherAllocations), {
  ssr: false,
});

// P328: the payer sheet's code loads only when someone opens it, like the mapping sheet (issue #182).
const PayerSheet = dynamic(() => import("./payer-sheet").then((module) => module.PayerSheet), { ssr: false });

/** P328: the sheet's choices in the board's order; a personal space has no fund and nobody else to pay (#170). */
const SHARED_MODES: readonly PayMode[] = ["FUND", "PAYERS", "EACH", "SAVINGS"];
const PERSONAL_MODES: readonly PayMode[] = ["EACH", "SAVINGS"];
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
 * Decision U5 (#224): what "Más opciones" holds, said while it is folded. Each part is the draft's real value, never a
 * default: the rollover mode, then the allocation rule or each member's value as typed ("Empieza de cero · 42 % / 58 %").
 * A personal line answers to its one member, so it has no allocation part.
 */
function foldSummary(
  draft: AllocationDraft,
  members: readonly SpaceMemberDto[],
  currency: string,
  formats: Formats,
): string | null {
  if (draft.rule !== "PERCENT" && draft.rule !== "FIXED") return null;
  const exponent = currencyOf(currency).exponent;
  return members
    .map((member) => {
      const decimal = parseDecimal(draft.values[member.id] ?? "", formats.numberFormat);
      if (decimal === null) return "—";
      if (draft.rule === "PERCENT") return formatPercent(decimal, formats);
      const minor = minorOf(decimal, exponent);
      return minor === null ? "—" : formatMoney({ amount: minor, currency }, formats);
    })
    .join(" / ");
}

/**
 * HU-E9-08, the LineEditor artboard (rulings P210 to P213, board 05): a line's name beside its planned amount, its
 * funding as radios in a card, and a categories card with the catch-all checkbox. Decision U5 (#224) folds the
 * rollover and who answers for it (the allocation, with its preview) under "Más opciones", whose summary shows their
 * current values; an existing line's removal waits at the end of the fold, behind a confirmation. An existing line of
 * a plan past its draft also shows what was planned, spent and left. Saving sends the steps that have something to
 * send, in order, each with the `If-Match` of the plan the step before answered.
 */
export function LineEditor({
  space,
  plan: initial,
  line,
  savingsAccounts,
  groups,
  members: everyone,
  hasFund = false,
  viewerMemberId = null,
  formats,
  favorites = [],
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
  /** The space's members in join order, one allocation row each but a viewer's who holds nothing (#217). */
  readonly members: readonly SpaceMemberDto[];
  /** D26: whether the space has a shared fund, so "Lo pagan directo" pays for it. */
  readonly hasFund?: boolean;
  /** The viewer's member id, so the sheet says "(tú)". */
  readonly viewerMemberId?: string | null;
  readonly formats: Formats;
  /** Ruling P342 (S2): the person's favorite currencies, which the currency sheet lists after the space's. */
  readonly favorites?: readonly string[];
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting.lineEditor");
  const tRollover = useTranslations("budgeting.rollover");
  const tReports = useTranslations("reports.lines");
  const tMapping = useTranslations("budgeting.mapping");
  const tAllocation = useTranslations("budgeting.allocation");
  const tRule = useTranslations("budgeting.rule");
  const tPay = useTranslations("budgeting.lineEditor.pay");
  const periodWord = usePeriodWord();
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const ids = useId();
  // #217: a viewer who holds no capacity and no share of this line gets no allocation row, so none is sent for them.
  const members = useMemo(
    () => everyone.filter((member) => takesPart(initial, member, line)),
    [everyone, initial, line],
  );
  const [plan, setPlan] = useState(initial);
  const [draft, setDraft] = useState<LineDraft>(() => lineDraftOf(line, formats));
  const [categoryIds, setCategoryIds] = useState<readonly string[]>(() => line?.categoryIds ?? []);
  // Ruling P342 (S7): the line's budgets one per currency, or null while its one budget is the space currency's.
  const [rows, setRows] = useState<readonly BudgetRow[] | null>(() => budgetRowsOf(line, formats));
  const [budgetError, setBudgetError] = useState<{ currency: string; text: string } | null>(null);
  // The allocation draft is the first budget's; a FIXED line's amounts in its other currencies are kept apart.
  const [allocationDraft, setAllocationDraft] = useState<AllocationDraft>(() => {
    const first = budgetRowsOf(line, formats)?.[0];
    return first && line?.allocation.rule === "FIXED"
      ? { rule: "FIXED", values: fixedValuesOf(line, first.currency, formats) }
      : allocationDraftOf(line, formats);
  });
  const [otherValues, setOtherValues] = useState<Readonly<Record<string, Readonly<Record<string, string>>>>>(
    () =>
      Object.fromEntries(
        (budgetRowsOf(line, formats) ?? [])
          .slice(1)
          .map((row) => [row.currency, fixedValuesOf(line, row.currency, formats)]),
      ),
  );
  const [mapping, setMapping] = useState(false);
  const [paying, setPaying] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** A blocked save opens the fold, and the allocation takes focus once it is on screen. */
  const focusAllocation = useRef(false);
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
  useEffect(() => {
    if (!moreOpen || !focusAllocation.current) return;
    focusAllocation.current = false;
    allocationSection.current?.focus();
  }, [moreOpen]);

  const currency = plan.totalCapacity.currency;
  const lineId = stored?.id ?? null;
  // Issue #175: a personal plan's line answers to its one member, so it has no "Quién responde" nor capacity check.
  const personal = space.kind === "PERSONAL";
  // Ruling P342 (S7): the allocation editor speaks of the first budget; each other currency's comes after it.
  const primary = rows?.[0]?.currency ?? currency;
  const minorIn = (text: string, of: string) => {
    const decimal = parseDecimal(text, formats.numberFormat);
    return decimal === null ? null : minorOf(decimal, currencyOf(of).exponent);
  };
  const plannedMinor = minorIn(rows?.[0]?.text ?? draft.planned, primary);
  const plannedNow = {
    amount: plannedMinor ?? (rows === null ? stored?.plannedAmount.amount : undefined) ?? "0",
    currency: primary,
  };
  /** Each member's contribution in `of`, the plan's figures per currency ("Misma regla, por moneda"). */
  const capacitiesIn = (of: string) =>
    members.map((member) => ({
      memberId: member.id,
      capacity:
        (
          (plan.currencies ?? []).find((c) => c.totalCapacity.currency === of)?.capacities ??
          (of === currency ? plan.capacities : [])
        ).find((capacity) => capacity.memberId === member.id)?.amount.amount ?? "0",
    }));
  const preview = previewOf(allocationDraft, {
    planned: plannedNow.amount,
    currency: primary,
    members: capacitiesIn(primary),
    numberFormat: formats.numberFormat,
  });
  const otherCurrencies = (rows ?? []).slice(1).map((row) => {
    const values = otherValues[row.currency] ?? {};
    return {
      currency: row.currency,
      values,
      preview: previewOf(allocationDraft.rule === "FIXED" ? { rule: "FIXED", values } : allocationDraft, {
        planned: minorIn(row.text, row.currency) ?? "0",
        currency: row.currency,
        members: capacitiesIn(row.currency),
        numberFormat: formats.numberFormat,
      }),
    };
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
    setBudgetError(null);
    let budgets: MoneyDto[] | undefined;
    // P342 (ADR 0004): a line in several currencies reads its budgets with the code it already loaded to show them.
    let perCurrency: typeof import("./per-currency") | null = null;
    if (rows !== null) {
      inFlight.current = true;
      perCurrency = await import("./per-currency");
      inFlight.current = false;
      const read = perCurrency.budgetsOf(rows, formats.numberFormat);
      if (!read.ok) {
        setBudgetError({
          currency: read.currency,
          text: t("unreadable", { example: formatNumber("1500000", formats) }),
        });
        return;
      }
      budgets = read.budgets;
    }
    const built = lineBodyOf(draft, currency, formats.numberFormat, budgets);
    if (!built.ok) {
      setFieldError({
        field: built.field,
        text: t("unreadable", { example: formatNumber("1500000", formats) }),
      });
      return;
    }
    // The preview already shows why: a sum that does not hold, nobody with capacity, or a value nobody can read.
    // A personal space has no one to share a line with, so it never asks (issue #175).
    if (
      !personal &&
      (preview.kind === "invalid" ||
        preview.kind === "noCapacity" ||
        preview.kind === "unreadable" ||
        otherCurrencies.some(({ preview: other }) => other.kind === "invalid" || other.kind === "unreadable"))
    ) {
      if (moreOpen) allocationSection.current?.focus();
      else {
        focusAllocation.current = true;
        setMoreOpen(true);
      }
      return;
    }
    const allocation = allocationBodyOf(
      allocationDraft,
      members.map((member) => member.id),
      primary,
      formats.numberFormat,
      otherCurrencies,
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
      // P303: the form leaves without a history entry, so Volver on the planner never reopens it.
      leaveSheet(router, back, () => router.refresh());
    } else {
      setPlan(outcome.plan);
      if (outcome.lineId !== null)
        setStored(outcome.plan.lines.find((other) => other.id === outcome.lineId) ?? stored);
      if (outcome.problem.code === "PreconditionFailed") await conflict(outcome.problem);
      else if (outcome.section !== "line") {
        setSectionError({ section: outcome.section, text: messageOf(outcome.problem).message });
        // A refused allocation speaks in its own section, so the fold opens to show it.
        if (outcome.section === "allocation") setMoreOpen(true);
      } else {
        const field = lineFieldOf(outcome.problem);
        if (field === "form") setFormProblem(outcome.problem);
        else if (field === "planned" && rows !== null) {
          // P342: the problem names no currency; the budget that passes what is left to assign in its own does.
          const over =
            outcome.problem.code === "PlanExceedsCapacity"
              ? (perCurrency?.exceededCurrency(budgets ?? [], plan, stored) ?? null)
              : null;
          setBudgetError({
            currency: over ?? rows[0]!.currency,
            text:
              over === null ? messageOf(outcome.problem).message : t("budgets.exceeds", { currency: over }),
          });
        } else setFieldError({ field, text: messageOf(outcome.problem).message });
      }
    }
    inFlight.current = false;
    setPending(false);
  };

  /** A budget in another currency joins the line; the one "Planeado" field becomes its first row. */
  const addBudget = (code: string) => {
    if (rows === null && code !== currency)
      setRows([
        { currency, text: draft.planned },
        { currency: code, text: "" },
      ]);
    else if (rows !== null) setRows([...rows, { currency: code, text: "" }]);
  };
  const renameBudget = (index: number, code: string) => {
    if (rows === null) return;
    const from = rows[index]!.currency;
    setRows(rows.map((row, i) => (i === index ? { ...row, currency: code } : row)));
    if (index > 0)
      setOtherValues(({ [from]: values, ...rest }) => (values ? { ...rest, [code]: values } : rest));
  };
  /** A ✕ drops a budget; one left in the space currency is the line's one "Planeado" again. */
  const removeBudget = (index: number) => {
    if (rows === null) return;
    const next = rows.filter((_, i) => i !== index);
    const first = next[0]!;
    // The allocation editor follows the first budget: a FIXED line's amounts in the new first move into it.
    if (index === 0 && allocationDraft.rule === "FIXED")
      setAllocationDraft({ rule: "FIXED", values: otherValues[first.currency] ?? {} });
    if (next.length === 1 && first.currency === currency) {
      change({ planned: first.text }, "planned");
      setRows(null);
      setOtherValues({});
    } else setRows(next);
    setBudgetError(null);
  };

  const remove = async () => {
    if (inFlight.current || line === null) return;
    setFormProblem(null);
    inFlight.current = true;
    setPending(true);
    const result = await removeLine(api, { spaceId: space.id, plan, lineId: line.id });
    if (result.ok) {
      // P303: the form leaves without a history entry, so Volver on the planner never reopens it.
      leaveSheet(router, back, () => router.refresh());
    } else if (result.problem.code === "PreconditionFailed") await conflict(result.problem);
    else setFormProblem(result.problem);
    inFlight.current = false;
    setPending(false);
  };

  const name = errorOf("name");
  const payersError = errorOf("payers");
  // P328: the row and note say how the line is paid; payers keep the member list's order and drop a former member.
  const candidates = payerCandidates(everyone);
  const payMode = payModeOf(draft);
  const payerNames = namesOf(draft.payerMemberIds, everyone);
  const named = joinNames(payerNames, tPay("and"));
  const lineName = draft.name.trim() || (line?.name ?? t("newTitle"));
  const monthly = periodName(plan.period, space.periodPolicy).kind === "month";
  const period = periodWord(plan.period, space.periodPolicy, formats);
  const payTitle =
    payMode === "PAYERS"
      ? tPay("paidBy", { names: named, count: payerNames.length })
      : tPay(`mode.${payMode}`);
  const paySubtitle =
    payMode === "PAYERS"
      ? tPay("rowScope", {
          scope: tPay(`scopeRow.${draft.payersScope}`, { period, monthly: String(monthly) }),
        })
      : tPay("row");
  const assigned = preview.kind === "assigned" ? preview.amounts : null;
  const assignedTo = (memberId: string) => BigInt(assigned?.[memberId] ?? "0");
  const plannedBig = BigInt(plannedNow.amount);
  const shares =
    assigned === null || plannedBig <= 0n
      ? null
      : members
          .filter((member) => assignedTo(member.id) > 0n)
          .map((member) => {
            // The board says whole percentages ("Ana 40 %"), rounded half up.
            const whole = (assignedTo(member.id) * 200n + plannedBig) / (plannedBig * 2n);
            return `${member.displayName} ${formatPercent(String(whole), formats)}`;
          })
          .join(" · ") || null;
  const others = members.filter(
    (member) => !draft.payerMemberIds.includes(member.id) && assignedTo(member.id) > 0n,
  );
  const othersNote =
    others.length === 1
      ? ` ${tPay("note.otherOne", {
          name: others[0]!.displayName,
          amount: money({ amount: String(assignedTo(others[0]!.id)), currency: primary }),
        })}`
      : others.length > 1
        ? ` ${tPay("note.othersMany", {
            names: joinNames(
              others.map((m) => m.displayName),
              tPay("and"),
            ),
          })}`
        : "";
  const payNote =
    payMode !== "PAYERS" || payerNames.length === 0
      ? null
      : draft.funding === "SHARED_FUND"
        ? tPay("note.fund", { names: named, count: payerNames.length, line: lineName }) + othersNote
        : tPay("note.direct", { names: named, count: payerNames.length, line: lineName });
  const planned = errorOf("planned");
  const savingsError = errorOf("savings");
  const catchAllError = errorOf("catchAll");
  const chosen = categoryIds.flatMap((id) => {
    const category = findCategory(groups, id)?.category;
    return category ? [category] : [];
  });
  const categoriesError = sectionError?.section === "categories" ? sectionError.text : undefined;
  const allocationError = sectionError?.section === "allocation" ? sectionError.text : undefined;
  const allocationSummary = personal
    ? null
    : (foldSummary(allocationDraft, members, primary, formats) ?? tRule(allocationDraft.rule));
  const summary =
    allocationSummary === null
      ? tRollover(draft.rolloverMode)
      : t("more.summary", { rollover: tRollover(draft.rolloverMode), allocation: allocationSummary });

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
      <ScreenHeader
        backHref={back}
        title={line === null ? t("newTitle") : t("title", { name: line.name })}
        subtitle={rows === null ? undefined : t("budgets.subtitle")}
      />

      {/* Board 05: a draft counts no expenses yet, so its line has no figures to show. */}
      {line !== null && plan.status !== "DRAFT" ? (
        <section aria-labelledby={`${ids}-figures`} className="rounded-xl border border-line bg-surface p-3">
          <h2 id={`${ids}-figures`} className="sr-only">
            {t("figures")}
          </h2>
          {/* P335: each figure keeps to one line, and one that does not fit beside the others moves whole to the next
              row; `flex-1` keeps the ones on a row equally wide. */}
          {/* Ruling P342 (S7): a line in several currencies shows each currency's figures, a row each. */}
          {(budgetRowsOf(line, formats) === null
            ? [line]
            : (line.budgets ?? []).map((budget) => ({ ...budget, plannedAmount: budget.planned }))
          ).map((figures, index) => (
            <dl
              key={figures.plannedAmount.currency}
              className={`flex flex-wrap gap-2${index > 0 ? " mt-2" : ""}`}
            >
              {(
                [
                  ["planned", figures.plannedAmount],
                  ["spent", figures.spent],
                  ["available", figures.available],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex flex-1 flex-col">
                  <dt className="text-sm text-muted">{tReports(key)}</dt>
                  <Amount as="dd" className="font-semibold text-ink">
                    {money(value)}
                  </Amount>
                </div>
              ))}
              {index === 0 && line.carryOverFrom ? (
                <div className="flex min-w-0 basis-full flex-col">
                  <dt className="text-sm text-muted">{t("carryOver")}</dt>
                  <dd>
                    <CarryText line={line} policy={space.periodPolicy} formats={formats} />
                  </dd>
                </div>
              ) : null}
            </dl>
          ))}
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
        {/* Board 05: Nombre and Planeado share a row; what Planeado leaves to assign is said under both. Ruling P342
            (S7), board "Editar rubro · presupuesto por moneda": a line in several currencies has its name, then one
            budget per currency. */}
        <div className={`flex flex-col ${rows === null ? "gap-1.5" : "gap-3"}`}>
          <div className={rows === null ? "grid grid-cols-2 items-start gap-3" : "flex flex-col"}>
            <TextField
              id={`${ids}-name`}
              label={t("field.name")}
              autoComplete="off"
              value={draft.name}
              onChange={(event) => change({ name: event.target.value }, "name")}
              error={name}
            />
            {rows === null ? (
              <NumberField
                id={`${ids}-planned`}
                label={t("field.planned")}
                kind="money"
                numberFormat={formats.numberFormat}
                decimals={currencyOf(currency).exponent}
                currency={currency}
                example={false}
                className="font-semibold"
                aria-describedby={[`${ids}-planned-note`, planned ? `${ids}-planned-error` : null]
                  .filter(Boolean)
                  .join(" ")}
                value={draft.planned}
                onChange={(planned) => change({ planned }, "planned")}
                error={planned}
              />
            ) : null}
          </div>
          {rows === null ? (
            <p id={`${ids}-planned-note`} className="text-sm [overflow-wrap:anywhere] text-muted">
              <AmountText
                text={
                  // Issue #175: in a shared plan the capacity check speaks here too, not only at the form's end.
                  !personal && preview.kind === "noCapacity"
                    ? tAllocation("noCapacity")
                    : line?.capacityShare != null
                      ? t("field.plannedHint", {
                          share: formatPercent(line.capacityShare, formats),
                          unallocated: money(plan.unallocated),
                        })
                      : t("field.plannedNewHint", { unallocated: money(plan.unallocated) })
                }
              />
            </p>
          ) : null}
          <BudgetFields
            idPrefix={ids}
            rows={rows}
            spaceCurrency={currency}
            favorites={favorites}
            formats={formats}
            errorOf={(of) => (budgetError?.currency === of ? budgetError.text : undefined)}
            onText={(index, text) => {
              setRows(rows && rows.map((row, i) => (i === index ? { ...row, text } : row)));
              if (budgetError?.currency === rows?.[index]?.currency) setBudgetError(null);
            }}
            onAdd={addBudget}
            onCurrency={renameBudget}
            onRemove={removeBudget}
          />
        </div>

        {/* P328, board "Editar rubro · lo paga Ana": one row says how the line is paid and opens the sheet; a note
            under it says what that does. */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-describedby={
              [payNote ? `${ids}-pay-note` : null, payersError ? `${ids}-payers-error` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onClick={() => setPaying(true)}
            className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 text-left"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base [overflow-wrap:anywhere] text-ink">{payTitle}</span>
              <span className="text-sm [overflow-wrap:anywhere] text-muted">{paySubtitle}</span>
            </span>
            <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
          </button>
          {payNote ? (
            <p id={`${ids}-pay-note`} className="text-sm [overflow-wrap:anywhere] text-muted">
              <AmountText text={payNote} />
            </p>
          ) : null}
          {payersError ? <FieldError id={`${ids}-payers-error`}>{payersError}</FieldError> : null}
        </div>

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

        {/* Issue #182 (P256): what sits below the fold is laid out and painted only when it nears the viewport, so
            the first frame lands before the framework chunks start evaluating and Lighthouse stops counting them. Its
            paint containment clips at the padding box, so `-m-1 p-1` keeps room for the 2 px focus outline and its
            2 px offset. */}
        <div className="-m-1 flex flex-col gap-4 p-1 [contain-intrinsic-size:auto_640px] [content-visibility:auto]">
          {/* Board 05: the categories are a card, with "Elegir" beside its heading and the catch-all inside it. */}
          {!savings ? (
            <div
              role="group"
              aria-labelledby={`${ids}-categories`}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id={`${ids}-categories`} className="text-base font-semibold text-ink">
                  {tMapping("label")}
                </h2>
                <Button
                  variant="ghost"
                  size="compact"
                  className="-mr-2 font-medium"
                  aria-label={tMapping("choose")}
                  onClick={() => setMapping(true)}
                >
                  {tMapping("chooseShort")}
                </Button>
              </div>
              {chosen.length > 0 ? (
                <ul aria-labelledby={`${ids}-categories`} className="flex flex-wrap gap-2">
                  {chosen.map((category) => (
                    <li
                      key={category.id}
                      className="rounded-full border border-accent px-3 py-1 text-sm [overflow-wrap:anywhere] text-ink"
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
              <div className="flex flex-col gap-1 border-t border-line pt-3">
                <label
                  htmlFor={`${ids}-catch-all`}
                  className="flex min-h-11 cursor-pointer items-start gap-3"
                >
                  <input
                    id={`${ids}-catch-all`}
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-accent"
                    checked={draft.isCatchAll}
                    onChange={(event) => change({ isCatchAll: event.target.checked }, "catchAll")}
                    aria-labelledby={`${ids}-catch-all-label`}
                    aria-describedby={[
                      `${ids}-catch-all-hint`,
                      catchAllError ? `${ids}-catch-all-error` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span id={`${ids}-catch-all-label`} className="font-semibold text-ink">
                      {t("field.catchAll")}
                    </span>
                    <span id={`${ids}-catch-all-hint`} className="text-sm text-muted">
                      {t("field.catchAllHint")}
                    </span>
                  </span>
                </label>
                {catchAllError ? (
                  <FieldError id={`${ids}-catch-all-error`}>{catchAllError}</FieldError>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Decision U5 (#224): rollover and allocation fold under "Más opciones"; the summary under the button
              always says their current values, so a folded money setting never hides a custom one. */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls={`${ids}-more`}
              aria-describedby={`${ids}-more-summary`}
              onClick={() => setMoreOpen((open) => !open)}
              className="flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent"
            >
              {t("more.open")}
              <Icon
                name="chevronDown"
                size={18}
                className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </button>
            <p id={`${ids}-more-summary`} className="px-1 text-sm [overflow-wrap:anywhere] text-muted">
              <AmountText text={summary} />
            </p>
          </div>
          <div id={`${ids}-more`} hidden={!moreOpen} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 id={`${ids}-rollover`} className="text-base font-semibold text-ink">
                {t("field.rollover")}
              </h2>
              <ChoiceGroup
                label={t("field.rollover")}
                labelledBy={`${ids}-rollover`}
                value={draft.rolloverMode}
                options={ROLLOVERS.map((value) => ({ value, label: tRollover(value) }))}
                onValueChange={(rolloverMode) => change({ rolloverMode })}
                describedBy={`${ids}-rollover-hint`}
              />
              <p id={`${ids}-rollover-hint`} className="text-sm text-muted">
                {tRollover(`hint.${draft.rolloverMode}`)}
                {draft.rolloverMode === "RESET" ? "" : ` ${tRollover("throughCopy")}`}
              </p>
            </div>

            {personal ? null : (
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
                currency={primary}
                planned={plannedNow}
              />
            )}
            {personal || otherCurrencies.length === 0 ? null : (
              <OtherAllocations
                rule={allocationDraft.rule}
                currencies={otherCurrencies}
                members={members}
                formats={formats}
                onValues={(of, values) => {
                  setOtherValues((current) => ({ ...current, [of]: values }));
                  setSectionError(null);
                }}
              />
            )}
            {allocationError ? (
              <FieldError id={`${ids}-allocation-error`}>{allocationError}</FieldError>
            ) : null}
            {/* Board 05 shows no removal: it waits at the end of the fold, behind its confirmation. */}
            {line !== null ? (
              <Button
                variant="dangerGhost"
                size="compact"
                className="-ml-2 self-start"
                disabled={pending}
                onClick={() => {
                  setFormProblem(null);
                  setRemoving(true);
                }}
              >
                <Icon name="trash" size={18} />
                {t("remove.open")}
              </Button>
            ) : null}
          </div>

          {formProblem !== null && !removing ? <ProblemNotice problem={formProblem} /> : null}
          <Button type="submit" size="lg" disabled={pending}>
            {line === null ? t("add") : t("save")}
          </Button>
        </div>
      </form>

      {paying ? (
        <PayerSheet
          open={paying}
          onOpenChange={setPaying}
          lineName={lineName}
          value={{ mode: payMode, payerMemberIds: draft.payerMemberIds, payersScope: draft.payersScope }}
          modes={personal ? PERSONAL_MODES : SHARED_MODES}
          hasFund={hasFund}
          candidates={candidates}
          viewerMemberId={viewerMemberId}
          period={period}
          monthly={monthly}
          shares={personal ? null : shares}
          namesOf={(ids) => joinNames(namesOf(ids, everyone), tPay("and"))}
          onDone={(choice) =>
            change(choiceFor(choice.mode, choice.payerMemberIds, choice.payersScope, hasFund), "payers")
          }
        />
      ) : null}

      {mapping ? (
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
      ) : null}

      {line !== null ? (
        <>
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
