"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AccountPicker } from "@/modules/accounts/ui";
import {
  activeTree,
  CategoryPicker,
  categoryPath,
  groupsForKind,
  type CategoryChoice,
} from "@/modules/categories/ui";
import { Button, ChoiceGroup, Icon, ProblemNotice, ScreenHeader, SymbolIcon } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto, CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import {
  decimalOf,
  formatDate,
  formatMoney,
  formatNumber,
  type Formats,
} from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import { AmountField } from "../record/amount-field";
import { DescriptionField, FormRow, RowError } from "../record/form-rows";
import { preferredAccountId, readLastAccount } from "../record/last-account";
import { useIdempotencyKey } from "../record/use-idempotency-key";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import { SharedFields } from "../split/shared-fields";
import type { SplitDraft } from "../split/split-request";
import { DateSheet } from "./date-sheet";
import {
  changesOf,
  definitionOf,
  recurrenceFieldOf,
  scheduleDraftOf,
  scheduleOf,
  stepDay,
  type RecurrenceDraft,
  type RecurrenceDto,
  type RecurrenceField,
  type RecurrenceMode,
  type RecurrenceType,
  type ScheduleDraft,
} from "./recurrence-request";
import { useSchedulePreview } from "./use-schedule-preview";

export interface RecurrenceFormProps {
  readonly space: SpaceDto;
  /** The space's active accounts: an income's receiving account, a transfer's two, a personal expense's. */
  readonly accounts: readonly AccountDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
  /** The person's today, where a new recurrence starts. */
  readonly today: string;
  /** The definer's member id in the space: who pays a personal expense. */
  readonly meMemberId: string;
  /** A shared or direct space: its expense names who pays and how it is split (HU-E9-06, S7). */
  readonly shared?: SharedExpenseContext | undefined;
  readonly api?: Api;
  /** Edits this recurrence through PATCH: its type, payer, accounts, split and start stay as defined. */
  readonly edit?: RecurrenceDto | undefined;
}

type Sheet = "category" | "account" | "toAccount" | "fund" | "start" | "end" | null;

/** The −/+ day stepper of P270: a 44 px button each side of the day, inside a named group. */
function DayStepper({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly onChange: (day: number) => void;
}) {
  const t = useTranslations("recurrences.form");
  const step = "flex size-11 shrink-0 items-center justify-center rounded-xl text-xl font-semibold text-ink";
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className="text-sm font-medium text-ink">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        className="flex items-center gap-1 rounded-[14px] border border-line bg-surface"
      >
        <button
          type="button"
          aria-label={t("dayDown", { label })}
          disabled={value <= 1}
          onClick={() => onChange(stepDay(value, -1))}
          className={`${step} disabled:opacity-40 before:content-['−']`}
        ></button>
        <output className="w-10 text-center text-lg font-semibold text-ink tabular-nums">{value}</output>
        <button
          type="button"
          aria-label={t("dayUp", { label })}
          disabled={value >= 31}
          onClick={() => onChange(stepDay(value, 1))}
          className={`${step} disabled:opacity-40 before:content-['+']`}
        ></button>
      </div>
    </div>
  );
}

/** The amount as the form types it, from the API's minor units ("1200000" for $ 1.200.000). */
const typedAmountOf = (recurrence: RecurrenceDto, formats: Formats) =>
  formatNumber(decimalOf(recurrence.amount.amount, currencyOf(recurrence.amount.currency).exponent), formats);

const draftOf = (
  edit: RecurrenceDto | undefined,
  today: string,
  accounts: readonly AccountDto[],
  formats: Formats,
): RecurrenceDraft =>
  edit
    ? {
        type: edit.type,
        amount: typedAmountOf(edit, formats),
        description: edit.description,
        category: edit.categoryId ? { categoryId: edit.categoryId, subcategoryId: null } : null,
        accountId: edit.type === "INCOME" ? edit.destinationAccountId : edit.sourceAccountId,
        toAccountId: edit.type === "TRANSFER" ? edit.destinationAccountId : null,
        fundId: edit.type === "FUND_CONTRIBUTION" ? edit.destinationAccountId : null,
        schedule: scheduleDraftOf(edit.schedule),
        mode: edit.mode,
        startDate: edit.startDate,
        endDate: edit.endDate,
      }
    : {
        type: "EXPENSE",
        amount: "",
        description: "",
        category: null,
        accountId: preferredAccountId(accounts, readLastAccount()),
        toAccountId: null,
        fundId: null,
        schedule: { kind: "MONTHLY", day: Number(today.slice(8)), day1: 15, day2: 30 },
        mode: "AUTO",
        startDate: today,
        endDate: null,
      };

/**
 * HU-E9-09, P270's "Nuevo movimiento recurrente": a full screen with "Guardar recurrente" pinned. The type, amount,
 * description, category and who pays (a shared space folds the split under Más opciones with the record form's
 * editor, S7), the schedule set with − and +, its dates, how it records, and "Próximas fechas" from P269's preview.
 */
export function RecurrenceForm({
  space,
  accounts,
  groups,
  formats,
  today,
  meMemberId,
  shared,
  api: injected,
  edit,
}: RecurrenceFormProps) {
  const t = useTranslations("recurrences");
  const ledger = useTranslations("ledger");
  const errors = useTranslations("errors");
  const router = useRouter();
  const toast = useToast();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const live = useMemo(() => activeTree(groups), [groups]);
  const [draft, setDraft] = useState<RecurrenceDraft>(() => draftOf(edit, today, accounts, formats));
  const [split, setSplit] = useState<SplitDraft | null>(() =>
    shared ? initialSplitDraft(shared, preferredAccountId(shared.myAccounts, readLastAccount())) : null,
  );
  const [sheet, setSheet] = useState<Sheet>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [unbuilt, setUnbuilt] = useState<{ field: RecurrenceField; reason?: "exactSplit" } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const { type } = draft;
  const sharedExpense =
    !edit && shared && split && type === "EXPENSE"
      ? { split, memberIds: shared.members.map((m) => m.id) }
      : undefined;
  const built = edit
    ? changesOf(draft, { currency: space.currency, numberFormat: formats.numberFormat })
    : definitionOf(draft, {
        currency: space.currency,
        numberFormat: formats.numberFormat,
        meMemberId,
        shared: sharedExpense,
      });
  const { key, renew } = useIdempotencyKey(built.ok ? JSON.stringify(built.body) : "");
  const schedule = scheduleOf(draft.schedule);
  const preview = useSchedulePreview({
    api,
    spaceId: space.id,
    schedule,
    startDate: draft.startDate,
    endDate: draft.endDate,
  });

  const found = problem ? recurrenceFieldOf(problem) : null;
  const errorOf = (field: RecurrenceField): string | undefined => {
    if (unbuilt?.field === field)
      return unbuilt.reason === "exactSplit"
        ? t("form.exactSplit")
        : field === "amount"
          ? ledger("form.amountUnreadable", { example: formatNumber("85000", formats) })
          : field === "category"
            ? errors("CategoryRequired")
            : ledger("form.accountRequired");
    return problem && found === field ? messageOf(problem).message : undefined;
  };
  // A field's error is about its last value: it goes as soon as that field changes.
  const clear = useCallback((...fields: RecurrenceField[]) => {
    setUnbuilt((current) => (current && fields.includes(current.field) ? null : current));
    setProblem((current) => {
      const field = current ? recurrenceFieldOf(current) : null;
      return field !== null && field !== "form" && fields.includes(field) ? null : current;
    });
  }, []);
  const change = (next: Partial<RecurrenceDraft>, ...fields: RecurrenceField[]) => {
    setDraft((current) => ({ ...current, ...next }));
    clear(...fields);
  };
  const changeSchedule = (next: Partial<ScheduleDraft>) =>
    change({ schedule: { ...draft.schedule, ...next } }, "dates");
  const changeSplit = useCallback(
    (next: SplitDraft) => {
      setSplit(next);
      clear("split", "payer");
    },
    [clear],
  );
  const changeType = (next: RecurrenceType) => {
    // A category the new type's sheet does not offer goes, so it is never saved unseen.
    const offered =
      (next === "EXPENSE" || next === "INCOME") &&
      groupsForKind(live, next).some((g) => g.categories.some((c) => c.id === draft.category?.categoryId));
    const fromAccounts = next === "FUND_CONTRIBUTION" ? (shared?.myAccounts ?? []) : accounts;
    change(
      {
        type: next,
        category: offered ? draft.category : null,
        accountId: fromAccounts.some((a) => a.id === draft.accountId)
          ? draft.accountId
          : preferredAccountId(fromAccounts, readLastAccount()),
        toAccountId: null,
      },
      "category",
      "account",
      "toAccount",
      "fund",
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    if (!built.ok) {
      setUnbuilt({ field: built.field, ...(built.reason ? { reason: built.reason } : {}) });
      if (built.field === "split") setMoreOpen(true);
      return;
    }
    setUnbuilt(null);
    setPending(true);
    try {
      const { data, error, response } = edit
        ? await api.PATCH("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}", {
            params: { path: { spaceId: space.id, recurrenceId: edit.id } },
            body: built.body as never,
          })
        : await api.POST("/api/v1/spaces/{spaceId}/recurrences", {
            params: { path: { spaceId: space.id }, header: { "idempotency-key": key } },
            // Ruling P118: the form builds a plain object; the API is the validator of its shape.
            body: built.body as never,
          });
      if (response.ok && data) {
        if (!edit) renew();
        toast.show({ message: t(edit ? "form.edited" : "form.saved") });
        router.replace(
          edit ? `/spaces/${space.id}/recurrences/${edit.id}` : `/spaces/${space.id}/recurrences`,
        );
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const typed = parseDecimal(draft.amount, formats.numberFormat);
  const minor = typed === null ? null : minorOf(typed, currencyOf(space.currency).exponent);
  const positiveMinor = minor !== null && BigInt(minor) > 0n ? minor : null;
  const categoryId = draft.category ? (draft.category.subcategoryId ?? draft.category.categoryId) : null;
  const nameOf = (list: readonly AccountDto[], id: string | null) =>
    list.find((a) => a.id === id)?.name ?? null;
  const fromAccounts = type === "FUND_CONTRIBUTION" ? (shared?.myAccounts ?? []) : accounts;
  const row = (
    field: RecurrenceField,
    name: string,
    value: string | null,
    open: Sheet,
    placeholder: string,
    icon: ReactNode,
  ) => {
    const error = errorOf(field);
    return (
      <li>
        <FormRow
          name={name}
          value={value ?? placeholder}
          icon={icon}
          onClick={() => setSheet(open)}
          errorId={error ? `recurrence-${field}-error` : undefined}
        />
        {error ? <RowError id={`recurrence-${field}-error`}>{error}</RowError> : null}
      </li>
    );
  };
  const accountIcon = <SymbolIcon name="wallet" size={16} />;
  const calendarIcon = <Icon name="calendar" size={16} />;
  const types: RecurrenceType[] = [
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    ...(shared && shared.funds.length > 0 ? (["FUND_CONTRIBUTION"] as const) : []),
  ];
  const datesError =
    errorOf("dates") ?? (preview.status === "failed" ? messageOf(preview.problem).message : undefined);
  const sharedError = errorOf("split") ?? errorOf("payer");
  const sharedTitle = [
    draft.description.trim() || (categoryId ? categoryPath(groups, categoryId) : null),
    positiveMinor ? formatMoney({ amount: positiveMinor, currency: space.currency }, formats) : null,
    space.name,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-3 py-3">
      <ScreenHeader
        backHref={edit ? `/spaces/${space.id}/recurrences/${edit.id}` : `/spaces/${space.id}/recurrences`}
        title={edit ? t("form.editTitle") : t("form.title")}
        subtitle={space.name}
      />
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {edit ? (
          <p className="text-sm text-muted">{t("form.fixedType", { type: t(`type.${type}`) })}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <h2 id="recurrence-type" className="text-sm font-semibold text-ink">
              {t("form.type")}
            </h2>
            <ChoiceGroup
              label={t("form.type")}
              labelledBy="recurrence-type"
              layout="chips"
              value={type}
              onValueChange={changeType}
              options={types.map((value) => ({ value, label: t(`type.${value}`) }))}
            />
          </div>
        )}
        <AmountField
          value={draft.amount}
          onChange={(amount) => change({ amount }, "amount")}
          symbol={currencyOf(space.currency).symbol}
          numberFormat={formats.numberFormat}
          exponent={currencyOf(space.currency).exponent}
          error={errorOf("amount")}
          autoFocus={!edit}
        />
        <DescriptionField
          value={draft.description}
          onChange={(description) => change({ description }, "description")}
          label={ledger("form.description")}
          placeholder={t("form.descriptionPlaceholder")}
          error={errorOf("description")}
        />
        <ul
          aria-label={ledger("form.details")}
          className="divide-y divide-line overflow-hidden rounded-2xl bg-surface"
        >
          {type === "EXPENSE" || type === "INCOME"
            ? row(
                "category",
                ledger("form.category"),
                categoryId ? categoryPath(groups, categoryId) : null,
                "category",
                ledger("form.chooseCategory"),
                <SymbolIcon name="tag" size={16} />,
              )
            : null}
          {type === "FUND_CONTRIBUTION" && !edit
            ? row(
                "fund",
                t("form.fund"),
                nameOf(shared?.funds ?? [], draft.fundId),
                "fund",
                t("form.chooseFund"),
                accountIcon,
              )
            : null}
          {/* A shared expense names who pays in its own rows below (P168); an edit keeps who pays (PATCH). */}
          {edit || sharedExpense
            ? null
            : row(
                "account",
                ledger(
                  type === "TRANSFER"
                    ? "form.from"
                    : type === "INCOME"
                      ? "form.receivingAccount"
                      : "form.account",
                ),
                nameOf(fromAccounts, draft.accountId),
                "account",
                ledger("form.chooseAccount"),
                accountIcon,
              )}
          {type === "TRANSFER" && !edit
            ? row(
                "toAccount",
                ledger("form.to"),
                nameOf(accounts, draft.toAccountId),
                "toAccount",
                ledger("form.chooseAccount"),
                accountIcon,
              )
            : null}
        </ul>
        {sharedExpense && shared && split ? (
          <div className="flex flex-col gap-3">
            {/* Who pays stays on screen; only the division folds (issue #171), with the record form's editor. */}
            <SharedFields
              context={shared}
              draft={split}
              onChange={changeSplit}
              amount={positiveMinor}
              currency={space.currency}
              formats={formats}
              title={sharedTitle}
              spaceId={space.id}
              categoryId={categoryId}
              date={draft.startDate}
              api={api}
              error={sharedError}
              splitHidden={!moreOpen}
              splitId="recurrence-more-split"
            />
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="recurrence-more-split"
              onClick={() => setMoreOpen((open) => !open)}
              className="flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent"
            >
              {moreOpen ? ledger("form.fewerOptions") : ledger("form.moreOptions")}
              <Icon
                name="chevronDown"
                size={18}
                className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col gap-3">
          <h2 id="recurrence-repeats" className="text-sm font-semibold text-ink">
            {t("form.repeats")}
          </h2>
          <ChoiceGroup
            label={t("form.repeats")}
            labelledBy="recurrence-repeats"
            value={draft.schedule.kind}
            onValueChange={(kind) => changeSchedule({ kind })}
            options={[
              { value: "MONTHLY" as const, label: t("form.monthly") },
              { value: "SEMI_MONTHLY" as const, label: t("form.semiMonthly") },
            ]}
          />
          {draft.schedule.kind === "MONTHLY" ? (
            <DayStepper
              id="recurrence-day"
              label={t("form.day")}
              value={draft.schedule.day}
              onChange={(day) => changeSchedule({ day })}
            />
          ) : (
            <>
              <DayStepper
                id="recurrence-day1"
                label={t("form.firstDay")}
                value={draft.schedule.day1}
                onChange={(day1) => changeSchedule({ day1 })}
              />
              <DayStepper
                id="recurrence-day2"
                label={t("form.secondDay")}
                value={draft.schedule.day2}
                onChange={(day2) => changeSchedule({ day2 })}
              />
            </>
          )}
          <p className="text-sm text-muted">{t("form.shortMonth")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <ul
            aria-label={t("form.repeats")}
            className="divide-y divide-line overflow-hidden rounded-2xl bg-surface"
          >
            <li>
              {edit ? (
                <div className="flex min-h-12 items-center gap-3 px-3 py-1">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
                  >
                    {calendarIcon}
                  </span>
                  <span className="w-[72px] shrink-0 text-[13px] leading-tight text-muted">
                    {t("form.starts")}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium text-ink">
                    {formatDate(draft.startDate, formats)}
                  </span>
                </div>
              ) : (
                <FormRow
                  name={t("form.starts")}
                  value={formatDate(draft.startDate, formats)}
                  icon={calendarIcon}
                  onClick={() => setSheet("start")}
                />
              )}
            </li>
            <li>
              <FormRow
                name={t("form.ends")}
                value={draft.endDate ? formatDate(draft.endDate, formats) : t("form.noEnd")}
                icon={calendarIcon}
                onClick={() => setSheet("end")}
                errorId={datesError ? "recurrence-dates-error" : undefined}
              />
            </li>
          </ul>
          {datesError ? (
            <p id="recurrence-dates-error" className="flex items-center gap-1.5 text-sm text-danger">
              <Icon name="alert" size={16} />
              {datesError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <h2 id="recurrence-mode" className="text-sm font-semibold text-ink">
            {t("form.how")}
          </h2>
          <ChoiceGroup<RecurrenceMode>
            label={t("form.how")}
            labelledBy="recurrence-mode"
            layout="list"
            value={draft.mode}
            onValueChange={(mode) => change({ mode })}
            options={[
              { value: "AUTO", label: t("mode.AUTO"), description: t("form.autoHint") },
              { value: "CONFIRM", label: t("mode.CONFIRM"), description: t("form.confirmHint") },
            ]}
          />
        </div>
        <p
          data-testid="recurrence-preview"
          role="status"
          className="flex items-start gap-2 rounded-2xl bg-accent-soft p-3 text-sm font-semibold text-accent"
        >
          <Icon name="calendar" size={18} className="mt-0.5 shrink-0" />
          <span>
            {preview.status === "ready"
              ? preview.dates.length > 0
                ? t("form.preview", {
                    dates: preview.dates.map((date) => formatDate(date, formats)).join(" · "),
                  })
                : t("form.previewNone")
              : preview.status === "loading"
                ? t("form.previewLoading")
                : t("form.previewNone")}
          </span>
        </p>
        {problem && found === "form" ? <ProblemNotice problem={problem} /> : null}
        {/* P270: pinned at the bottom of its stacked screen (P272, no bottom bar), so saving never needs a scroll. */}
        <div className="sticky bottom-[env(safe-area-inset-bottom)] bg-bg py-3 lg:bottom-0">
          <Button type="submit" size="lg" disabled={pending}>
            {edit ? t("form.saveEdit") : t("form.save")}
          </Button>
        </div>
        <CategoryPicker
          open={sheet === "category"}
          onOpenChange={(open) => setSheet(open ? "category" : null)}
          groups={groupsForKind(live, type === "INCOME" ? "INCOME" : "EXPENSE")}
          value={(draft.category as CategoryChoice) ?? null}
          onChoose={(category) => change({ category }, "category")}
        />
        <AccountPicker
          open={sheet === "account"}
          onOpenChange={(open) => setSheet(open ? "account" : null)}
          accounts={fromAccounts}
          value={draft.accountId}
          onChoose={(accountId) =>
            change(
              { accountId, ...(accountId === draft.toAccountId ? { toAccountId: null } : {}) },
              "account",
              "toAccount",
            )
          }
          label={ledger(type === "TRANSFER" ? "form.from" : "form.account")}
        />
        <AccountPicker
          open={sheet === "toAccount"}
          onOpenChange={(open) => setSheet(open ? "toAccount" : null)}
          accounts={accounts.filter((a) => a.id !== draft.accountId)}
          value={draft.toAccountId}
          onChoose={(toAccountId) => change({ toAccountId }, "toAccount")}
          label={ledger("form.to")}
        />
        <AccountPicker
          open={sheet === "fund"}
          onOpenChange={(open) => setSheet(open ? "fund" : null)}
          accounts={shared?.funds ?? []}
          value={draft.fundId}
          onChoose={(fundId) => change({ fundId }, "fund")}
          label={t("form.fund")}
        />
        <DateSheet
          open={sheet === "start"}
          onOpenChange={(open) => setSheet(open ? "start" : null)}
          title={t("form.starts")}
          value={draft.startDate}
          today={today}
          formats={formats}
          onChoose={(startDate) => {
            if (startDate) change({ startDate }, "dates");
          }}
        />
        <DateSheet
          open={sheet === "end"}
          onOpenChange={(open) => setSheet(open ? "end" : null)}
          title={t("form.ends")}
          value={draft.endDate}
          today={draft.startDate}
          formats={formats}
          onChoose={(endDate) => change({ endDate }, "dates")}
          noneLabel={t("form.noEnd")}
        />
      </form>
    </div>
  );
}
