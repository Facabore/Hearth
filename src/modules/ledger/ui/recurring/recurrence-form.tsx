"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AccountPicker } from "@/modules/accounts/ui";
import {
  activeTree,
  CategoryIcon,
  CategoryPicker,
  categoryPath,
  findCategory,
  groupsForKind,
  type CategoryChoice,
} from "@/modules/categories/ui";
import {
  Button,
  ChoiceGroup,
  Icon,
  NumberField,
  ProblemNotice,
  ScreenHeader,
  SymbolIcon,
  TextField,
} from "@/shared/ui";
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
import { RowError } from "../record/form-rows";
import { preferredAccountId, readLastAccount } from "../record/last-account";
import { useIdempotencyKey } from "../record/use-idempotency-key";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import type { SplitDraft } from "../split/split-request";
import { DateSheet } from "./date-sheet";
import { CardRow, RadioCard, Tile } from "./form-parts";
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
import { useRecurrenceSplit } from "./recurrence-split";
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
    open: () => void,
    placeholder: string,
    icon: ReactNode,
  ) => {
    const error = errorOf(field);
    return (
      <li>
        <CardRow
          name={name}
          value={value ?? placeholder}
          icon={icon}
          onClick={open}
          errorId={error ? `recurrence-${field}-error` : undefined}
        />
        {error ? <RowError id={`recurrence-${field}-error`}>{error}</RowError> : null}
      </li>
    );
  };
  // Board 02: the chosen category's own tile; an account, a fund or who paid on a blue one; the dates on a neutral one.
  const chosen = categoryId ? findCategory([...groups], categoryId) : null;
  const categoryIcon = chosen ? (
    <CategoryIcon icon={chosen.category.icon} color={chosen.category.color} size={40} />
  ) : (
    <Tile palette="PINE">
      <SymbolIcon name="tag" size={20} />
    </Tile>
  );
  const accountIcon = (
    <Tile palette="SKY">
      <SymbolIcon name="bank" size={20} />
    </Tile>
  );
  const calendarIcon = (
    <Tile palette="GRAPHITE">
      <Icon name="calendar" size={20} />
    </Tile>
  );
  const types: RecurrenceType[] = [
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    ...(shared && shared.funds.length > 0 ? (["FUND_CONTRIBUTION"] as const) : []),
  ];
  const datesError =
    errorOf("dates") ?? (preview.status === "failed" ? messageOf(preview.problem).message : undefined);
  const sharedTitle = [
    draft.description.trim() || (categoryId ? categoryPath(groups, categoryId) : null),
    positiveMinor ? formatMoney({ amount: positiveMinor, currency: space.currency }, formats) : null,
    space.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const splitView = useRecurrenceSplit({
    enabled: sharedExpense !== undefined,
    context: shared,
    draft: split,
    onChange: changeSplit,
    amount: positiveMinor,
    currency: space.currency,
    formats,
    title: sharedTitle,
    spaceId: space.id,
    categoryId,
    date: draft.startDate,
    api,
  });
  const splitError = errorOf("split");

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
              // Board 02: the chosen type carries a check, so it is never told by its tint alone.
              options={types.map((value) => ({
                value,
                label:
                  value === type ? (
                    <span className="flex items-center gap-1">
                      <Icon name="check" size={16} />
                      {t(`type.${value}`)}
                    </span>
                  ) : (
                    t(`type.${value}`)
                  ),
              }))}
            />
          </div>
        )}
        {/* Board 02: Monto and Descripción each labelled above their field, the amount as the large figure with its
            symbol inside, with no example under it. The design system's own labelled fields draw both. */}
        <NumberField
          id="recurrence-amount"
          label={ledger("form.amount")}
          kind="money"
          numberFormat={formats.numberFormat}
          decimals={currencyOf(space.currency).exponent}
          symbol={currencyOf(space.currency).symbol}
          example={false}
          large
          value={draft.amount}
          onChange={(amount) => change({ amount }, "amount")}
          error={errorOf("amount")}
          // A new definition opens on its amount, so the keyboard comes up with it; an edit never takes the focus.
          autoFocus={!edit}
        />
        <TextField
          id="recurrence-description"
          label={ledger("form.description")}
          autoComplete="off"
          value={draft.description}
          placeholder={t("form.descriptionPlaceholder")}
          onChange={(event) => change({ description: event.target.value }, "description")}
          error={errorOf("description")}
        />
        <ul
          aria-label={ledger("form.details")}
          className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface"
        >
          {type === "EXPENSE" || type === "INCOME"
            ? row(
                "category",
                ledger("form.category"),
                categoryId ? categoryPath(groups, categoryId) : null,
                () => setSheet("category"),
                ledger("form.chooseCategory"),
                categoryIcon,
              )
            : null}
          {type === "FUND_CONTRIBUTION" && !edit
            ? row(
                "fund",
                t("form.fund"),
                nameOf(shared?.funds ?? [], draft.fundId),
                () => setSheet("fund"),
                t("form.chooseFund"),
                accountIcon,
              )
            : null}
          {/* Board 02: a shared expense's "Pagó" is the card's second row, opening the record form's split editor
              (P168); an edit keeps who pays (PATCH). */}
          {splitView
            ? row("payer", ledger("split.payer"), splitView.payer, splitView.open, "", accountIcon)
            : null}
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
                () => setSheet("account"),
                ledger("form.chooseAccount"),
                accountIcon,
              )}
          {type === "TRANSFER" && !edit
            ? row(
                "toAccount",
                ledger("form.to"),
                nameOf(accounts, draft.toAccountId),
                () => setSheet("toAccount"),
                ledger("form.chooseAccount"),
                accountIcon,
              )
            : null}
        </ul>
        {splitView ? (
          <div className="flex flex-col gap-1">
            {/* Who pays stays in the card; only the division folds (issue #171), summed up under the toggle. */}
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
            {moreOpen ? null : (
              <p data-testid="recurrence-split-summary" className="px-1 text-[13px] text-muted">
                {t("form.splitSummary", { parts: splitView.parts })}
              </p>
            )}
            <div id="recurrence-more-split" hidden={!moreOpen} className="flex flex-col gap-1">
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <CardRow
                  name={ledger("split.split")}
                  value={splitView.parts}
                  icon={
                    <Tile palette="PINE">
                      <SymbolIcon name="users" size={20} />
                    </Tile>
                  }
                  onClick={splitView.open}
                  errorId={splitError ? "recurrence-split-error" : undefined}
                />
                {splitError ? <RowError id="recurrence-split-error">{splitError}</RowError> : null}
              </div>
            </div>
            {splitView.sheet}
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
          {/* Board 03: Empieza and Termina as two rows of one card, each label above its date. */}
          <ul
            aria-label={t("form.dates")}
            className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface"
          >
            <li>
              <CardRow
                name={t("form.starts")}
                value={formatDate(draft.startDate, formats)}
                icon={calendarIcon}
                // An edit keeps its start (PATCH): the same row, with nothing to open.
                onClick={edit ? undefined : () => setSheet("start")}
              />
            </li>
            <li>
              <CardRow
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
          <RadioCard<RecurrenceMode>
            labelledBy="recurrence-mode"
            name="recurrence-mode"
            value={draft.mode}
            onChange={(mode) => change({ mode })}
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
        {/* P270: pinned at the bottom of its stacked screen (P272, no bottom bar), so saving never needs a scroll.
            Board 02 draws it as a white bar across the screen, a line above it. */}
        <div className="sticky bottom-[env(safe-area-inset-bottom)] -mx-4 border-t border-line bg-surface px-4 py-3 max-[359px]:-mx-3 max-[359px]:px-3 lg:bottom-0">
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
