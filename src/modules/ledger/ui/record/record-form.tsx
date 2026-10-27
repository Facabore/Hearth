"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import { AccountPicker } from "@/modules/accounts/ui";
import {
  activeTree,
  CategoryPicker,
  categoryPath,
  groupsForKind,
  type CategoryChoice,
} from "@/modules/categories/ui";
import { Button, Icon, ProblemNotice, ScreenHeader, SymbolIcon } from "@/shared/ui";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  CategoryGroupDto,
  DirectSplitDto,
  RecordedExpenseDto,
  SpaceDto,
} from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { safeReturnTo, withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn } from "@/shared/ui/time/when";
import type { Person } from "../direct/counterparts";
// A type only: no runtime code of the edit modules enters the record route (P191, P198).
import type { RecordInitial } from "../edit/edit-initial";
import { categoryKeyOf, directBodyOf, type DirectChoice } from "../direct/direct-request";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import { SharedFields } from "../split/shared-fields";
import { AmountField } from "./amount-field";
import { DateTimeSheet } from "./date-time-sheet";
import { DescriptionField, FormRow, RowError } from "./form-rows";
import { LineWarningConfirm, LineWarningNote } from "./line-warning";
import { offeredRecent, parseRecent, rawRecent, rememberRecent, safeStorage } from "./recent-categories";
import { asksFirst, lineWarningOf, type LineWatch } from "./line-watch";
import {
  afterSaveUrl,
  movementUrl,
  fundWentNegative,
  recordFieldOf,
  requestOf,
  type RecordField,
  type RecordKind,
} from "./record-request";
import { useIdempotencyKey } from "./use-idempotency-key";
import { whenLabel, type When } from "./when-label";

// The sheet's code loads only when someone opens it, so the personal form keeps its script budget (P177).
const SplitWithPersonSheet = dynamic(
  () => import("../direct/split-with-person-sheet").then((module) => module.SplitWithPersonSheet),
  { ssr: false },
);

/** Recents change only when this form saves, and it reads them again on the next mount. */
const noSubscription = () => () => undefined;

const KINDS = ["EXPENSE", "INCOME", "TRANSFER"] as const;
const KIND_PANEL = "record-kind-panel";
const kindTabId = (kind: RecordKind) => `record-kind-${kind.toLowerCase()}`;

/**
 * The kind tabs, as the WAI-ARIA tabs pattern: one tab stop on the selected tab, and the arrow keys move and select
 * (automatic activation), wrapping. Issue #182: written without Radix Tabs, whose roving-focus code weighed on the
 * record route's script.
 */
function KindTabs({
  label,
  value,
  onChange,
  labelOf,
}: {
  readonly label: string;
  readonly value: RecordKind;
  readonly onChange: (kind: RecordKind) => void;
  readonly labelOf: (kind: RecordKind) => string;
}) {
  const tabs = useRef(new Map<RecordKind, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = KINDS[(KINDS.indexOf(value) + step + KINDS.length) % KINDS.length]!;
    onChange(next);
    tabs.current.get(next)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={move} className="flex rounded-[14px] bg-track p-1">
      {KINDS.map((k) => (
        <button
          key={k}
          ref={(node) => {
            if (node) tabs.current.set(k, node);
            else tabs.current.delete(k);
          }}
          id={kindTabId(k)}
          type="button"
          role="tab"
          aria-selected={k === value}
          aria-controls={KIND_PANEL}
          data-state={k === value ? "active" : "inactive"}
          tabIndex={k === value ? 0 : -1}
          onClick={() => {
            if (k !== value) onChange(k);
          }}
          className="min-h-11 flex-1 rounded-[10px] text-sm font-medium text-ink data-[state=active]:bg-surface data-[state=active]:shadow"
        >
          {labelOf(k)}
        </button>
      ))}
    </div>
  );
}

type Sheet = "category" | "account" | "toAccount" | "when" | null;

/** Ruling P191: the form as the edit route uses it: it starts from a transaction and hands Save to the caller. */
export interface RecordEdit {
  readonly initial: RecordInitial;
  readonly backHref: string;
  /** Saves the built request; a problem is shown in the form, null means saved (the caller then navigates away). */
  readonly onSave: (
    built: { kind: RecordKind; body: Record<string, unknown> },
    state: { when: When },
  ) => Promise<Problem | null>;
  /** What to offer under a problem shown above the button, such as loading the latest version (P193). */
  readonly problemAction?: (problem: Problem) => ReactNode;
  /** Issue #195: the kind tabs are offered; saving another kind converts the movement instead of editing it. */
  readonly convertible?: boolean;
}

export interface RecordFormProps {
  readonly space: SpaceDto;
  readonly accounts: readonly AccountDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
  readonly initialKind: RecordKind;
  /** The server render's instant (ISO); the browser's clock replaces it on mount unless a time was chosen. */
  readonly initialNow: string;
  /** The recorder's zone; by default the browser's, read after mount (the profile's during the server render). */
  readonly timeZone?: string;
  readonly profileZone?: string;
  /** A shared or direct space: its expense names who paid and how it is split instead of one account (P168). */
  readonly shared?: SharedExpenseContext;
  /** The people the recorder shares a space with: a personal space's expense can be split with one (P172). */
  readonly people?: readonly Person[];
  readonly api?: Api;
  /** Edits a transaction instead of recording one: no split with someone, no plan's split (P192), and no kind tabs
   * unless the movement is convertible (issue #195). */
  readonly edit?: RecordEdit;
  /** #142 (P236): the lines of today's period, by category; no warning without it. */
  readonly lineWatch?: LineWatch | null;
  /** Issue #172: the screen the form was opened from; saving and the back arrow land there when it is a valid path. */
  readonly returnTo?: string | null;
}

/** HU-E9-03, the QuickAdd artboard as a page: amount, description, category, accounts, date and time, Save. */
export function RecordForm({
  space,
  accounts,
  groups,
  formats,
  initialKind,
  initialNow,
  timeZone,
  profileZone = "UTC",
  shared,
  people,
  api: injected,
  edit,
  lineWatch = null,
  returnTo = null,
}: RecordFormProps) {
  const t = useTranslations("ledger");
  const errors = useTranslations("errors");
  const router = useRouter();
  const toast = useToast();
  // Issue #172: the save lands where the form was opened, so the toast offers the movement itself.
  const savedToast = (kind: RecordKind, spaceId: string, transactionId: string | undefined) =>
    toast.show({
      message: t(`toast.saved.${kind}`),
      ...(transactionId
        ? {
            action: {
              label: t("toast.view"),
              onAction: () => router.push(movementUrl(spaceId, transactionId)),
            },
          }
        : {}),
    });
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const live = useMemo(() => activeTree(groups), [groups]);
  const serverZone = timeZone ?? profileZone;
  const [client, setClient] = useState<{ zone: string; now: When } | null>(null);
  useEffect(() => {
    const zone = timeZone ?? browserTimeZone();
    // The browser's clock and zone exist only after hydration (ruling P129); this is the one sync from them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClient({ zone, now: nowIn(new Date(), zone) });
  }, [timeZone]);
  const zone = client?.zone ?? serverZone;
  const start = client?.now ?? nowIn(new Date(initialNow), serverZone);
  const today = start.date;

  const [kind, setKind] = useState<RecordKind>(edit?.initial.kind ?? initialKind);
  const kindTabs = !edit || edit.convertible === true;
  // Issue #173: this browser's recent categories for the kind, read after mount so the server render never differs.
  const recentText = useSyncExternalStore(
    noSubscription,
    () => (kind === "TRANSFER" || edit ? null : rawRecent(safeStorage(), space.id, kind)),
    () => null,
  );
  const recent = useMemo(() => parseRecent(recentText), [recentText]);
  const [amount, setAmount] = useState(edit?.initial.amount ?? "");
  const [description, setDescription] = useState(edit?.initial.description ?? "");
  const [category, setCategory] = useState<CategoryChoice>(edit?.initial.category ?? null);
  const changeKind = (nextKind: RecordKind) => {
    setKind(nextKind);
    // Issue #173: a category the new kind's sheet does not offer goes, so it is never saved unseen.
    const offered =
      nextKind !== "TRANSFER" &&
      groupsForKind(live, nextKind).some((g) => g.categories.some((c) => c.id === category?.categoryId));
    if (category && !offered) setCategory(null);
  };
  // Issue #173: the recent categories the kind's sheet still lists, as one-tap chips.
  const offered = offeredRecent(recent, kind === "TRANSFER" ? [] : groupsForKind(live, kind));
  const remember = () => {
    if (kind !== "TRANSFER" && category)
      rememberRecent(safeStorage(), space.id, kind, {
        categoryId: category.categoryId,
        subcategoryId: category.subcategoryId ?? null,
      });
  };
  const [accountId, setAccountId] = useState<string | null>(
    edit ? edit.initial.accountId : (accounts[0]?.id ?? null),
  );
  const [toAccountId, setToAccountId] = useState<string | null>(edit?.initial.toAccountId ?? null);
  const [chosenWhen, setChosenWhen] = useState<When | null>(edit?.initial.when ?? null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetNow, setSheetNow] = useState<When>(start);
  const [pending, setPending] = useState(false);
  const [split, setSplit] = useState(
    () => edit?.initial.split ?? (shared ? initialSplitDraft(shared) : null),
  );
  const [unbuilt, setUnbuilt] = useState<"amount" | "account" | "toAccount" | "payer" | "split" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [direct, setDirect] = useState<DirectChoice | null>(null);
  const [directOpened, setDirectOpened] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [keylessTried, setKeylessTried] = useState(false);

  const when = chosenWhen ?? start;
  const draft = { kind, amount, description, category, accountId, toAccountId, when, timeZone: zone };
  const sharedExpense =
    shared && split && kind === "EXPENSE"
      ? { split, memberIds: shared.members.map((member) => member.id) }
      : undefined;
  const built = requestOf(draft, space.currency, formats.numberFormat, sharedExpense);
  // A split with someone is its own request (P172): choosing someone else makes a new draft, so a new key.
  const canSplit = !edit && people !== undefined && kind === "EXPENSE" && space.kind === "PERSONAL";
  const splitting = canSplit ? direct : null;
  const { key, renew } = useIdempotencyKey(
    built.ok ? JSON.stringify({ body: built.body, direct: splitting }) : "",
  );
  const categoryKey = categoryKeyOf(live, category);
  const days = {
    today: t("day.today"),
    yesterday: t("day.yesterday"),
    dayBeforeYesterday: t("day.dayBeforeYesterday"),
  };
  const label = whenLabel(when, today, formats, days);
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null;
  // The typed amount in minor units while it is above zero (the default split refuses 0), whatever else is unbuilt.
  const typed = parseDecimal(amount, formats.numberFormat);
  const minor = typed === null ? null : minorOf(typed, currencyOf(space.currency).exponent);
  const positiveMinor = minor !== null && BigInt(minor) > 0n ? minor : null;
  // #142 (P235, P236): only an expense of the form's own space, never a split with someone nor an edit.
  const chosenCategory = category ? (category.subcategoryId ?? category.categoryId) : null;
  const warning =
    kind === "EXPENSE" && !splitting && !edit
      ? lineWarningOf(lineWatch, {
          categoryId: chosenCategory,
          parentId: category?.subcategoryId ? category.categoryId : null,
          amountMinor: positiveMinor,
          date: when.date,
          currency: space.currency,
        })
      : null;
  // P235: the expense the person was asked about; a change of amount, category or date asks again.
  const asked = warning ? `${chosenCategory}|${positiveMinor}|${when.date}` : null;
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const confirmedFor = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const asking = asked !== null && askingFor === asked;
  const sharedTitle = [
    description.trim() ||
      (category ? categoryPath(groups, category.subcategoryId ?? category.categoryId) : null),
    positiveMinor ? formatMoney({ amount: positiveMinor, currency: space.currency }, formats) : null,
    space.name,
  ]
    .filter(Boolean)
    .join(" · ");
  // N7: a personal form can create an account and come back to itself, on the type being recorded. A shared
  // space's payer comes from the members' personal accounts, so it offers none.
  const newAccountHref = shared
    ? undefined
    : withReturnTo(
        `/spaces/${space.id}/accounts/new`,
        withReturnTo(
          `/spaces/${space.id}/new${kind === "EXPENSE" ? "" : `?type=${kind.toLowerCase()}`}`,
          returnTo,
        ),
      );
  const found = problem ? recordFieldOf(problem) : null;
  // In a shared expense the account an API problem names is the payer's.
  const where = sharedExpense && found === "account" ? "payer" : found;
  const errorOf = (field: RecordField): string | undefined => {
    // A category of the person's own cannot travel to the direct space; none chosen is asked for as usual.
    if (field === "category" && keylessTried && splitting && categoryKey === null)
      return category === null ? errors("CategoryRequired") : t("direct.noKey", { space: space.name });
    if (unbuilt === field)
      return field === "amount"
        ? t("form.amountUnreadable", { example: formatNumber("85000", formats) })
        : t("form.accountRequired");
    return problem && where === field ? messageOf(problem).message : undefined;
  };

  // A field's error is about its last value: it goes as soon as that field changes, never waiting for the next save.
  const clear = useCallback((...fields: RecordField[]) => {
    setUnbuilt((current) => (current !== null && fields.includes(current) ? null : current));
    setProblem((current) => {
      const field = current ? recordFieldOf(current) : null;
      return field !== null && field !== "form" && fields.includes(field) ? null : current;
    });
    if (fields.includes("category")) setKeylessTried(false);
  }, []);
  // The split and who paid share their rows: either one changing clears both, and the account an API problem names.
  const changeSplit = useCallback(
    (next: NonNullable<typeof split>) => {
      setSplit(next);
      clear("split", "payer", "account");
    },
    [clear],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    setKeylessTried(false);
    if (!built.ok) {
      setUnbuilt(built.field);
      return;
    }
    setUnbuilt(null);
    if (splitting && categoryKey === null) {
      setKeylessTried(true);
      return;
    }
    if (asksFirst(warning) && confirmedFor.current !== asked) {
      setAskingFor(asked);
      return;
    }
    setPending(true);
    try {
      if (edit) {
        const failed = await edit.onSave({ kind: built.kind, body: built.body }, { when });
        if (failed) {
          setProblem(failed);
          setPending(false);
        }
        return;
      }
      if (splitting && categoryKey !== null) {
        const { data, error, response } = await api.POST("/api/v1/direct-splits", {
          params: { header: { "idempotency-key": key } },
          body: directBodyOf(built.body, splitting, categoryKey) as never,
        });
        if (response.ok && data) {
          renew();
          remember();
          const split = data as DirectSplitDto;
          if (!fundWentNegative(split.expense.warnings))
            savedToast("EXPENSE", split.spaceId, split.expense.id);
          router.replace(afterSaveUrl(split.spaceId, split.expense.warnings, returnTo));
          router.refresh();
          return;
        }
        setProblem(problemFrom(error, response));
        setPending(false);
        return;
      }
      const options = {
        params: { path: { spaceId: space.id }, header: { "idempotency-key": key } },
        // Ruling P118: the form builds a plain object; the API is the validator of its shape.
        body: built.body as never,
      };
      const { data, error, response } =
        built.kind === "EXPENSE"
          ? await api.POST("/api/v1/spaces/{spaceId}/expenses", options)
          : built.kind === "INCOME"
            ? await api.POST("/api/v1/spaces/{spaceId}/incomes", options)
            : await api.POST("/api/v1/spaces/{spaceId}/transfers", options);
      if (response.ok) {
        renew();
        remember();
        const recorded = data as RecordedExpenseDto | undefined;
        const warnings = built.kind === "EXPENSE" ? recorded?.warnings : undefined;
        if (!fundWentNegative(warnings)) savedToast(built.kind, space.id, recorded?.id);
        router.replace(afterSaveUrl(space.id, warnings, returnTo));
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const row = (
    field: RecordField,
    name: string,
    value: string | null,
    open: Sheet,
    placeholder: string,
    icon: ReactNode,
  ): ReactNode => {
    const error = errorOf(field);
    return (
      <li>
        <FormRow
          name={name}
          value={value ?? placeholder}
          icon={icon}
          onClick={() => setSheet(open)}
          errorId={error ? `record-${field}-error` : undefined}
        />
        {error ? <RowError id={`record-${field}-error`}>{error}</RowError> : null}
      </li>
    );
  };
  const accountLabel = t(
    kind === "TRANSFER" ? "form.from" : kind === "INCOME" ? "form.receivingAccount" : "form.account",
  );
  const accountIcon = <SymbolIcon name="wallet" size={16} />;
  const whenError = errorOf("when");
  const directName = direct ? (direct.kind === "MEMBER" ? direct.name : direct.displayName) : "";

  // Issue #171: Más opciones folds how a shared expense is split (who paid stays on screen) and the button that starts
  // a split with someone; a person already chosen stays on screen. It starts open on an edit that already has a split.
  // While the division has a problem (the API's, or a chosen split that no longer adds up and disables Save) it is
  // open and offers no Menos opciones, so the problem cannot be folded away.
  const foldsShared = Boolean(sharedExpense && shared && split);
  const foldsDirect = canSplit && !direct;
  const foldable = foldsShared || foldsDirect;
  const sharedError = errorOf("split") ?? errorOf("payer");
  const divisionNeedsLook =
    foldsShared &&
    (sharedError !== undefined || Boolean(split?.chosen && !built.ok && built.field === "split"));
  const [moreOpen, setMoreOpen] = useState(Boolean(edit?.initial.split));
  if (divisionNeedsLook && !moreOpen) setMoreOpen(true);

  return (
    <div className="flex flex-col gap-3 py-3">
      <ScreenHeader
        backHref={edit?.backHref ?? safeReturnTo(returnTo) ?? `/spaces/${space.id}`}
        title={edit ? t("edit.title") : t("form.title")}
      />
      <form
        ref={formRef}
        data-ready={client ? "true" : undefined}
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-3"
      >
        <div>
          {kindTabs ? (
            <KindTabs
              label={t("form.kind")}
              value={kind}
              onChange={changeKind}
              labelOf={(k) => t(`type.${k}`)}
            />
          ) : (
            <p className="text-sm text-muted">{t("edit.kind", { type: t(`type.${kind}`) })}</p>
          )}
          {edit && kind !== edit.initial.kind ? (
            <p className="mt-2 text-sm text-muted">{t("edit.convertNote", { type: t(`type.${kind}`) })}</p>
          ) : null}
          <div
            id={KIND_PANEL}
            role={kindTabs ? "tabpanel" : undefined}
            aria-labelledby={kindTabs ? kindTabId(kind) : undefined}
            className="mt-3 flex flex-col gap-3"
            tabIndex={-1}
          >
            <AmountField
              value={amount}
              onChange={(next) => {
                setAmount(next);
                clear("amount");
              }}
              symbol={currencyOf(space.currency).symbol}
              numberFormat={formats.numberFormat}
              exponent={currencyOf(space.currency).exponent}
              error={errorOf("amount")}
              autoFocus={!edit}
            />
            <ul
              aria-label={t("form.details")}
              className="divide-y divide-line overflow-hidden rounded-2xl bg-surface"
            >
              {kind === "TRANSFER"
                ? null
                : row(
                    "category",
                    t("form.category"),
                    // The whole tree names it: an edited record may use a category archived since (the picker hides those).
                    category ? categoryPath(groups, category.subcategoryId ?? category.categoryId) : null,
                    "category",
                    t("form.chooseCategory"),
                    <SymbolIcon name="tag" size={16} />,
                  )}
              {/* A shared expense names who paid instead of one account, in its own row below (P168). */}
              {foldsShared
                ? null
                : row(
                    "account",
                    accountLabel,
                    nameOf(accountId),
                    "account",
                    t("form.chooseAccount"),
                    accountIcon,
                  )}
              {kind === "TRANSFER"
                ? row(
                    "toAccount",
                    t("form.to"),
                    nameOf(toAccountId),
                    "toAccount",
                    t("form.chooseAccount"),
                    accountIcon,
                  )
                : null}
              <li>
                <FormRow
                  name={t("form.date")}
                  value={label}
                  icon={<Icon name="calendar" size={16} />}
                  testId="when-chip"
                  ariaLabel={t("form.when", { label })}
                  errorId={whenError ? "record-when-error" : undefined}
                  onClick={() => {
                    setSheetNow(nowIn(new Date(), zone));
                    setSheet("when");
                  }}
                />
                {whenError ? <RowError id="record-when-error">{whenError}</RowError> : null}
              </li>
            </ul>
            {kind !== "TRANSFER" && offered.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p id="record-recent" className="text-sm text-muted">
                  {t("form.recent")}
                </p>
                <div role="group" aria-labelledby="record-recent" className="flex flex-wrap gap-2">
                  {offered.map((r) => {
                    const id = r.subcategoryId ?? r.categoryId;
                    const chosen =
                      category?.categoryId === r.categoryId &&
                      (category.subcategoryId ?? null) === r.subcategoryId;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => {
                          setCategory({ categoryId: r.categoryId, subcategoryId: r.subcategoryId });
                          clear("category");
                        }}
                        className="min-h-11 rounded-full border border-line px-4 text-sm font-medium text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft"
                      >
                        {categoryPath(groups, id)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <DescriptionField
              value={description}
              onChange={(next) => {
                setDescription(next);
                clear("description");
              }}
              label={t("form.description")}
              placeholder={t("form.descriptionPlaceholder")}
              error={errorOf("description")}
            />
            {foldable ? (
              <div className="flex flex-col gap-3">
                {/* Who paid stays on screen; only the division row folds (issue #171). Never unmounted (P167). */}
                {foldsShared && shared && split ? (
                  <SharedFields
                    context={shared}
                    draft={split}
                    onChange={changeSplit}
                    amount={positiveMinor}
                    currency={space.currency}
                    formats={formats}
                    title={sharedTitle}
                    spaceId={space.id}
                    categoryId={category ? (category.subcategoryId ?? category.categoryId) : null}
                    date={when.date}
                    api={api}
                    error={sharedError}
                    defaultSplit={!edit}
                    splitHidden={!moreOpen}
                    splitId="record-more-split"
                  />
                ) : null}
                {divisionNeedsLook ? null : (
                  <button
                    type="button"
                    aria-expanded={moreOpen}
                    aria-controls={foldsShared ? "record-more-split" : "record-more"}
                    onClick={() => setMoreOpen((open) => !open)}
                    className="flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm font-medium text-accent"
                  >
                    {moreOpen ? t("form.fewerOptions") : t("form.moreOptions")}
                    <Icon
                      name="chevronDown"
                      size={18}
                      className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"}
                    />
                  </button>
                )}
                {foldsDirect ? (
                  <div id="record-more" hidden={!moreOpen} className="flex flex-col gap-3">
                    <Button
                      variant="secondary"
                      className="self-start"
                      onClick={() => {
                        setDirectOpened(true);
                        setDirectOpen(true);
                      }}
                    >
                      <Icon name="userPlus" size={20} />
                      {t("direct.open")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canSplit && direct ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-4">
                <span className="min-w-0 py-2 font-medium break-words text-accent">
                  {t("direct.with", { name: directName })}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("direct.remove", { name: directName })}
                  onClick={() => setDirect(null)}
                >
                  <Icon name="close" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {asking && warning ? (
          <LineWarningConfirm
            warning={warning}
            formats={formats}
            onConfirm={() => {
              confirmedFor.current = asked;
              setAskingFor(null);
              formRef.current?.requestSubmit();
            }}
            onReview={() => {
              setAskingFor(null);
              document.getElementById("record-amount")?.focus();
            }}
          />
        ) : warning ? (
          <LineWarningNote warning={warning} formats={formats} />
        ) : null}
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
        {problem && where === "form" && edit?.problemAction ? edit.problemAction(problem) : null}
        {/* While asking, the panel's two buttons replace Save, so the last control stays above the bar (17c). */}
        {asking ? null : (
          <Button
            type="submit"
            size="md"
            className="w-full"
            disabled={pending || (!built.ok && built.field === "split")}
            aria-describedby={warning ? "record-line-warning" : undefined}
          >
            {edit ? t("edit.save") : t(`form.save.${splitting ? "DIRECT" : kind}`)}
          </Button>
        )}
        {directOpened && people ? (
          <SplitWithPersonSheet
            open={directOpen}
            onOpenChange={setDirectOpen}
            people={people}
            currency={space.currency}
            spaceName={space.name}
            onChoose={setDirect}
          />
        ) : null}
        <CategoryPicker
          open={sheet === "category"}
          onOpenChange={(open) => setSheet(open ? "category" : null)}
          groups={groupsForKind(live, kind === "INCOME" ? "INCOME" : "EXPENSE")}
          value={category}
          onChoose={(choice) => {
            setCategory(choice);
            clear("category");
          }}
        />
        <AccountPicker
          open={sheet === "account"}
          onOpenChange={(open) => setSheet(open ? "account" : null)}
          accounts={accounts}
          newAccountHref={newAccountHref}
          value={accountId}
          onChoose={(id) => {
            setAccountId(id);
            if (id === toAccountId) setToAccountId(null);
            clear("account", "toAccount");
          }}
          label={t(
            kind === "TRANSFER" ? "form.from" : kind === "INCOME" ? "form.receivingAccount" : "form.account",
          )}
        />
        <AccountPicker
          open={sheet === "toAccount"}
          onOpenChange={(open) => setSheet(open ? "toAccount" : null)}
          accounts={accounts.filter((a) => a.id !== accountId)}
          newAccountHref={newAccountHref}
          value={toAccountId}
          onChoose={(id) => {
            setToAccountId(id);
            clear("toAccount");
          }}
          label={t("form.to")}
        />
        <DateTimeSheet
          open={sheet === "when"}
          onOpenChange={(open) => setSheet(open ? "when" : null)}
          value={when}
          now={sheetNow}
          today={today}
          formats={formats}
          onApply={(next) => {
            setChosenWhen(next);
            clear("when");
          }}
        />
      </form>
    </div>
  );
}
