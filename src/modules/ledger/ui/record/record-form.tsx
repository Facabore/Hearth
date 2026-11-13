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
import { controlsFor } from "@/modules/spaces/ui";
import { activeTree, categoryPath, groupsForKind, type CategoryChoice } from "@/modules/categories/ui";
import { Button, Icon, ProblemNotice, ScreenHeader } from "@/shared/ui";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  CategoryDto,
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
import { formatMoney, formatNumber, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn } from "@/shared/ui/time/when";
import type { Person } from "../direct/counterparts";
// A type only: no runtime code of the edit modules enters the record route (P191, P198).
import type { RecordInitial } from "../edit/edit-initial";
import { categoryKeyOf, directBodyOf, type DirectChoice } from "../direct/direct-request";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import { SharedFields } from "../split/shared-fields";
import { AmountField } from "./amount-field";
import { CategoryTiles } from "./category-tiles";
import { useLeaveQuestion } from "@/shared/ui/navigation/hold-navigation";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import { DiscardConfirm, type HoldNavigation } from "./discard-confirm";
import { FormChip, SummaryRow } from "./form-chip";
import { DescriptionField, RowError } from "./form-rows";
import { Keypad } from "./keypad";
import { RecordSheet } from "./record-sheet";
import { LineWarningConfirm, LineWarningNote } from "./line-warning";
import { preferredAccountId, readLastAccount, rememberLastAccount } from "./last-account";
import { offeredRecent, parseRecent, rawRecent, rememberRecent, safeStorage } from "./recent-categories";
import { asksFirst, lineWarningOf, type LineWatch } from "./line-watch";
import {
  afterSaveUrl,
  movementUrl,
  contributionBodyOf,
  fundWentNegative,
  recordFieldOf,
  requestOf,
  sharedKindsOf,
  type RecordField,
  type RecordKind,
} from "./record-request";
import { handOver, heldFor, release } from "./record-carry";
import { useIdempotencyKey } from "./use-idempotency-key";
import { whenLabel, type When } from "./when-label";

// The sheet's code loads only when someone opens it, so the personal form keeps its script budget (P177).
/** The date and time sheet opens on a tap: it loads beside the form, not in its route (ADR 0004). */
const DateTimeSheet = dynamic(() => import("./date-time-sheet").then((module) => module.DateTimeSheet), {
  ssr: false,
});
const SplitWithPersonSheet = dynamic(
  () => import("../direct/split-with-person-sheet").then((module) => module.SplitWithPersonSheet),
  { ssr: false },
);
/** Ruling P291: the category picker of board B1 · 03, in a chunk of its own that loads when it first opens. */
const CategorySheet = dynamic(() => import("./category-sheet").then((module) => module.CategorySheet), {
  ssr: false,
});

/** Ruling P305: the spaces to record in, in a chunk of its own that loads on the first tap. */
const SpaceSheet = dynamic(() => import("./space-sheet").then((module) => module.SpaceSheet), { ssr: false });

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
  kinds = KINDS,
}: {
  readonly label: string;
  readonly value: RecordKind;
  readonly onChange: (kind: RecordKind) => void;
  readonly labelOf: (kind: RecordKind) => string;
  readonly kinds?: readonly RecordKind[];
}) {
  const tabs = useRef(new Map<RecordKind, HTMLButtonElement>());
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = kinds[(kinds.indexOf(value) + step + kinds.length) % kinds.length]!;
    onChange(next);
    tabs.current.get(next)?.focus();
  };
  return (
    // Ruling P324 (board "Registrar gasto"): the kinds as chips, the chosen one tinted; still the tabs pattern.
    <div role="tablist" aria-label={label} onKeyDown={move} className="flex flex-wrap gap-2">
      {kinds.map((k) => (
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
          className="min-h-11 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink data-[state=active]:border-accent-soft data-[state=active]:bg-accent-soft data-[state=active]:text-accent-strong"
        >
          {labelOf(k)}
        </button>
      ))}
    </div>
  );
}

type Sheet = "category" | "account" | "toAccount" | "when" | "space" | null;

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
  /**
   * Issue #195: the kinds the tabs offer; saving another kind converts the movement instead of editing it. In a shared
   * space a transfer is a contribution from the recorder's account to the fund (the owner's ruling).
   */
  readonly kinds?: readonly RecordKind[];
  /** Issue #198 (P188): a contribution's accounts never change, so while it stays a transfer its rows only show them. */
  readonly fixedAccounts?: boolean;
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
  /** Issue #215: leaving with something typed asks first; without it, leaving never asks. */
  readonly holdNavigation?: HoldNavigation;
  /** Ruling P305: the spaces the person records in; with more than one, the space chip changes it (never in an edit). */
  readonly spaces?: readonly Pick<SpaceDto, "id" | "name">[];
  /**
   * Ruling P308: the picker offers "Nueva categoría" only with it; the category made there is handed to it, which puts
   * it in `groups`, and the form chooses it.
   */
  readonly onCategoryCreated?: (category: CategoryDto) => void;
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
  holdNavigation,
  spaces = [],
  onCategoryCreated,
}: RecordFormProps) {
  const t = useTranslations("ledger");
  const errors = useTranslations("errors");
  const tAccounts = useTranslations("accounts");
  // P305: what the form of another space handed over when the person moved it here; never in an edit.
  const [carried] = useState(() => (edit ? null : heldFor(space.id)));
  useEffect(release, []);
  const spaceLabel = useTranslations("spaces.settings");
  const router = useRouter();
  const toast = useToast();
  // Issue #172: the save lands where the form was opened, so the toast offers the movement itself.
  const savedToast = (kind: RecordKind, spaceId: string, transactionId: string | undefined) =>
    toast.show({
      // #211: an expense that leaves its line above 90 % saves at once, and the toast says where the line is left.
      message:
        kind === "EXPENSE" && warning?.level === "HIGH"
          ? t("lineWarning.saved", {
              line: warning.line,
              used: warning.used === null ? "" : formatPercent(warning.used, formats),
              rest: formatMoney(warning.rest, formats),
            })
          : t(`toast.saved.${kind}`),
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

  // D25, ruling P321: a shared space records an expense and, with a fund, a contribution to it, never an income.
  const kindsOffered = edit ? edit.kinds : shared ? sharedKindsOf(space.kind) : undefined;
  const [kind, setKind] = useState<RecordKind>(() => {
    const wanted = edit?.initial.kind ?? carried?.kind ?? initialKind;
    return edit || !kindsOffered || kindsOffered.includes(wanted) ? wanted : "EXPENSE";
  });
  const kindTabs = edit ? edit.kinds !== undefined : kindsOffered === undefined || kindsOffered.length > 1;
  // Issue #195, ruling P321: a shared space's transfer goes from the recorder's own account into its fund.
  const fundTransfer = shared !== undefined && kind === "TRANSFER";
  const fromAccounts = fundTransfer ? shared.myAccounts : accounts;
  const toAccounts = fundTransfer ? shared.funds : accounts;
  // Issue #173: this browser's recent categories for the kind, read after mount so the server render never differs.
  const recentText = useSyncExternalStore(
    noSubscription,
    () => (kind === "TRANSFER" || edit ? null : rawRecent(safeStorage(), space.id, kind)),
    () => null,
  );
  const recent = useMemo(() => parseRecent(recentText), [recentText]);
  const [amount, setAmount] = useState(edit?.initial.amount ?? carried?.amount ?? "");
  const [description, setDescription] = useState(edit?.initial.description ?? carried?.description ?? "");
  const [category, setCategory] = useState<CategoryChoice>(edit?.initial.category ?? null);
  const changeKind = (nextKind: RecordKind) => {
    setKind(nextKind);
    if (shared && nextKind === "TRANSFER") {
      // A fund that paid is never the source of a contribution, and only a fund receives one.
      if (!shared.myAccounts.some((a) => a.id === accountId)) setAccountId(shared.myAccounts[0]?.id ?? null);
      // Ruling P321: a space's only fund is the one a contribution goes to.
      if (!shared.funds.some((a) => a.id === toAccountId))
        setToAccountId(shared.funds.length === 1 ? shared.funds[0]!.id : null);
    }
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
    // Issue #208: the account an expense was paid from is where the next one starts.
    const paidFrom = sharedExpense ? (split?.payer.kind === "ME" ? split.payer.accountId : null) : accountId;
    if (kind === "EXPENSE" && paidFrom) rememberLastAccount(paidFrom);
  };
  const [accountId, setAccountId] = useState<string | null>(() => {
    if (edit) return edit.initial.accountId;
    // Ruling P321: the account handed over by Crear un fondo, while it is still one Desde offers.
    const handed = carried?.accountId;
    if (handed && fromAccounts.some((a) => a.id === handed)) return handed;
    return preferredAccountId(fromAccounts, readLastAccount());
  });
  const [toAccountId, setToAccountId] = useState<string | null>(
    () =>
      edit?.initial.toAccountId ?? (fundTransfer && shared.funds.length === 1 ? shared.funds[0]!.id : null),
  );
  const [chosenWhen, setChosenWhen] = useState<When | null>(edit?.initial.when ?? carried?.when ?? null);
  const [spaceOpened, setSpaceOpened] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetNow, setSheetNow] = useState<When>(start);
  const [pending, setPending] = useState(false);
  const [split, setSplit] = useState(
    () =>
      edit?.initial.split ??
      (shared ? initialSplitDraft(shared, preferredAccountId(shared.myAccounts, readLastAccount())) : null),
  );
  const [unbuilt, setUnbuilt] = useState<"amount" | "account" | "toAccount" | "payer" | "split" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [direct, setDirect] = useState<DirectChoice | null>(null);
  const [directOpened, setDirectOpened] = useState(false);
  // The picker brings the dialog's code with it, so it loads on the first tap, not with the form (ADR 0004).
  const [pickerOpened, setPickerOpened] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [keylessTried, setKeylessTried] = useState(false);
  // Issue #215: what the person entered or chose, against what the form opened with; leaving asks only while they
  // differ. The default split may change the method by itself (P167), so only who paid and a chosen split count.
  const enteredOf = (typed: unknown[]) =>
    JSON.stringify([...typed, category, accountId, toAccountId, direct, split?.payer, split?.chosen]);
  const entered = enteredOf([amount, description, chosenWhen]);
  // P305: what another space's form handed over is the person's typing too, so it counts as entered.
  const [pristine] = useState(() => (carried ? enteredOf(["", "", null]) : entered));
  const dirty = entered !== pristine;
  // Settles the held navigation while the question is shown: true leaves, false stays. A save on its way is the
  // person leaving on purpose, so it is held no longer (ruling P307: the save goes back to where the form came from).
  const { answer } = useLeaveQuestion(dirty && !pending, holdNavigation);

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
  const nameOf = (id: string | null) =>
    [...accounts, ...(shared?.myAccounts ?? [])].find((a) => a.id === id)?.name ?? null;
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
  // Ruling P321: a contribution with no fund to receive it offers to create one, to whoever may (OWNER, ADMIN), and comes
  // back to this form on the transfer with what was typed; anyone else is told who creates it.
  const createsFund =
    fundTransfer && shared.funds.length === 0 && controlsFor(space.role, space.kind).manageFunds;
  const newFundHref = createsFund
    ? withReturnTo(
        `/spaces/${space.id}/accounts/new`,
        withReturnTo(`/spaces/${space.id}/new?type=transfer`, returnTo),
      )
    : undefined;
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
  // An edit opens with the amount selected (accessibility, 2026-11-13): while all of it is selected, the keypad's next
  // key replaces it, as a keyboard's does; moving the caret or typing ends that.
  const [replacing, setReplacing] = useState(edit !== undefined);
  // The keypad and the keyboard write the same amount.
  const changeAmount = (next: string) => {
    setAmount(next);
    setReplacing(false);
    clear("amount");
  };
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
          // Ruling P307: back to where the form was opened from, when that is where the save lands.
          leaveSheet(router, afterSaveUrl(split.spaceId, split.expense.warnings, returnTo), () =>
            router.refresh(),
          );
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
        built.kind === "TRANSFER" && fundTransfer
          ? await api.POST("/api/v1/spaces/{spaceId}/fund-contributions", {
              ...options,
              body: contributionBodyOf(built.body) as never,
            })
          : built.kind === "EXPENSE"
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
        // Ruling P307: back to where the form was opened from, when that is where the save lands.
        leaveSheet(router, afterSaveUrl(space.id, warnings, returnTo), () => router.refresh());
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  // Ruling P324 (board "Registrar gasto"): an account is a flat summary row, its value over what it is. A transfer's
  // "Desde" and "Hacia" are read before the account (#286); the others name it for screen readers.
  const accountRow = (
    field: RecordField,
    name: string,
    value: string | null,
    open: Sheet,
    placeholder: string,
    fixed = false,
  ): ReactNode => (
    <SummaryRow
      value={value ?? placeholder}
      meta={name}
      label={kind === "TRANSFER" ? undefined : name}
      onClick={fixed ? undefined : () => setSheet(open)}
      errorId={errorOf(field) ? `record-${field}-error` : undefined}
    />
  );
  const accountLabel = t(
    kind === "TRANSFER" ? "form.from" : kind === "INCOME" ? "form.receivingAccount" : "form.account",
  );
  const fixedAccounts = kind === "TRANSFER" && edit?.fixedAccounts === true;
  const directName = direct ? (direct.kind === "MEMBER" ? direct.name : direct.displayName) : "";

  // Ruling P324 (S5): how a shared expense is split and who paid are two summary rows, always on screen, so a problem
  // in either is never folded away (it replaced Más opciones, issue #171). U11 (#222): a personal expense's split with
  // someone is a row too; a person already chosen stays on screen.
  const sharedRows = Boolean(sharedExpense && shared && split);
  const offersDirect = canSplit && !direct;
  const chipErrors = (["account", "toAccount", "when"] as const).flatMap((field) => {
    const error = errorOf(field);
    return error ? [{ field, error }] : [];
  });
  const backHref = edit?.backHref ?? safeReturnTo(returnTo) ?? `/spaces/${space.id}`;
  const offeredGroups = kind === "TRANSFER" ? [] : groupsForKind(live, kind);
  const currency = currencyOf(space.currency);

  const content = (
    <form
      ref={formRef}
      data-ready={client ? "true" : undefined}
      onSubmit={(event) => void submit(event)}
      noValidate
      // S5 (ruling P324): in the sheet the form fills the height it is given; only the fields scroll, above a keypad and
      // a Guardar that never scroll, so the keypad's last row is never under Guardar. An edit's page scrolls as a whole.
      className={edit ? "flex flex-col gap-3" : "flex min-h-0 flex-1 flex-col"}
    >
      <div
        data-testid="record-fields"
        className={edit ? undefined : "-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3"}
      >
        {/* Ruling P308: the space comes first, since the categories, the accounts and the split below depend on it. */}
        <div className="mb-3 flex items-center gap-2">
          {edit ? null : <span className="text-sm text-muted">{t("form.recordIn")}</span>}
          <FormChip
            name={spaceLabel("title")}
            value={space.name}
            icon={<Icon name="home" size={16} />}
            {...(!edit && spaces.length > 1
              ? {
                  opens: true,
                  ariaLabel: t("form.space", { name: space.name }),
                  onClick: () => {
                    setSpaceOpened(true);
                    setSheet("space");
                  },
                }
              : {})}
          />
        </div>
        {kindTabs ? (
          <KindTabs
            label={t("form.kind")}
            value={kind}
            onChange={changeKind}
            labelOf={(k) => t(`type.${k}`)}
            {...(kindsOffered ? { kinds: kindsOffered } : {})}
          />
        ) : (
          <p className="text-sm text-muted">{t("edit.kind", { type: t(`type.${kind}`) })}</p>
        )}
        {edit && kind !== edit.initial.kind ? (
          <p className="mt-2 text-sm text-muted">{t("edit.convertNote", { type: t(`type.${kind}`) })}</p>
        ) : null}
        {/* Ruling P291, board B1 · 01's order: amount, description, category, the split, the chips, the keypad. */}
        <div
          id={KIND_PANEL}
          role={kindTabs ? "tabpanel" : undefined}
          aria-labelledby={kindTabs ? kindTabId(kind) : undefined}
          className="mt-3 flex flex-col gap-3"
          tabIndex={-1}
        >
          <AmountField
            value={amount}
            onChange={changeAmount}
            symbol={currency.symbol}
            numberFormat={formats.numberFormat}
            exponent={currency.exponent}
            error={errorOf("amount")}
            autoFocus
            selectOnOpen={edit !== undefined}
            onWholeSelected={setReplacing}
          />
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
          {kind === "TRANSFER" ? null : (
            <CategoryTiles
              groups={groups}
              offered={offeredGroups}
              recent={offered}
              value={category}
              onChoose={(choice) => {
                setCategory(choice);
                clear("category");
              }}
              onMore={() => {
                setPickerOpened(true);
                setSheet("category");
              }}
              error={errorOf("category")}
            />
          )}
          {/* U11 (#222): under the category, the way to split the expense with someone; a chosen person replaces it. */}
          {/* Ruling P324 (S5, board "Registrar gasto"): flat summary rows, each opening its sheet: how it is split, who
              paid and from which account, and the date. A row that does not apply to the kind or space is not drawn. */}
          <div className="flex flex-col">
            {/* U11 (#222): a personal expense's split with someone; a chosen person replaces the row. */}
            {offersDirect ? (
              <SummaryRow
                value={t("direct.open")}
                meta={t("direct.shared")}
                ariaLabel={t("direct.row")}
                onClick={() => {
                  setDirectOpened(true);
                  setDirectOpen(true);
                }}
              />
            ) : null}
            {canSplit && direct ? (
              <div className="flex items-center gap-2 border-b border-line">
                <span className="flex min-w-0 flex-1 flex-col py-2">
                  <span className="truncate text-base text-ink">
                    {t("direct.with", { name: directName })}
                  </span>
                  <span className="text-sm text-muted">{t("split.method")}</span>
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
            {/* A shared expense names who paid instead of one account (P168). Never unmounted while it applies (P167). */}
            {sharedRows && shared && split ? (
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
                error={errorOf("split")}
                payerError={errorOf("payer")}
                defaultSplit={!edit}
              />
            ) : null}
            <div role="group" aria-label={t("form.details")} className="flex flex-col">
              {sharedRows
                ? null
                : accountRow(
                    "account",
                    accountLabel,
                    nameOf(accountId),
                    "account",
                    t("form.chooseAccount"),
                    fixedAccounts,
                  )}
              {kind === "TRANSFER"
                ? accountRow(
                    "toAccount",
                    t("form.to"),
                    nameOf(toAccountId),
                    "toAccount",
                    t("form.chooseAccount"),
                    fixedAccounts,
                  )
                : null}
              <SummaryRow
                label={t("form.when", { label })}
                value={label}
                meta={t("form.date")}
                testId="when-chip"
                ariaLabel={t("form.when", { label })}
                errorId={errorOf("when") ? "record-when-error" : undefined}
                onClick={() => {
                  setSheetNow(nowIn(new Date(), zone));
                  setSheet("when");
                }}
                last
              />
            </div>
            {chipErrors.map(({ field, error }) => (
              <RowError key={field} id={`record-${field}-error`}>
                {error}
              </RowError>
            ))}
          </div>
        </div>
      </div>
      <div
        data-testid="record-controls"
        className={edit ? "flex flex-col gap-3" : "flex shrink-0 flex-col gap-3 pt-1"}
      >
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
        {/* While asking, the panel's two buttons replace the keypad and Save, so the last control stays in view (17c). */}
        {asking ? null : (
          <Keypad
            value={replacing ? "" : amount}
            onChange={changeAmount}
            numberFormat={formats.numberFormat}
            exponent={currency.exponent}
            // Pesos are typed whole (their shares round to whole pesos, P183): 000, not a point.
            point={currency.roundingUnit < 10n ** BigInt(currency.exponent)}
          />
        )}
      </div>
      {/* #281 (audit pass 3, A1): Save is pinned to the bottom (of the sheet, or of the edit page), so on a 375×667 or
          320×640 phone it is on screen before any scroll. S5 (P324): it comes after the keypad, never over it. */}
      {asking ? null : (
        <div
          data-testid="record-save"
          className={`sticky bottom-0 z-10 shrink-0 pt-2 ${
            edit ? "bg-bg pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "bg-surface pb-1"
          }`}
        >
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || (!built.ok && built.field === "split")}
            aria-describedby={warning ? "record-line-warning" : undefined}
          >
            {edit ? t("edit.save") : t(`form.save.${splitting ? "DIRECT" : kind}`)}
          </Button>
        </div>
      )}
      {directOpened && people ? (
        <SplitWithPersonSheet
          open={directOpen}
          onOpenChange={setDirectOpen}
          people={people}
          onChoose={setDirect}
        />
      ) : null}
      {kind === "TRANSFER" || !pickerOpened ? null : (
        <CategorySheet
          open={sheet === "category"}
          onOpenChange={(open) => setSheet(open ? "category" : null)}
          groups={offeredGroups}
          value={category}
          recent={offered}
          onChoose={(choice) => {
            setCategory(choice);
            clear("category");
          }}
          space={space}
          {...(onCategoryCreated
            ? {
                creation: {
                  api,
                  kind,
                  onCreated: (made: CategoryDto) => {
                    onCategoryCreated(made);
                    setCategory({ categoryId: made.id, subcategoryId: null });
                    clear("category");
                  },
                },
              }
            : {})}
        />
      )}
      <AccountPicker
        open={sheet === "account"}
        onOpenChange={(open) => setSheet(open ? "account" : null)}
        accounts={fromAccounts}
        newAccountHref={newAccountHref}
        value={accountId}
        onChoose={(id) => {
          setAccountId(id);
          if (id === toAccountId) setToAccountId(null);
          clear("account", "toAccount");
        }}
        label={accountLabel}
      />
      <AccountPicker
        open={sheet === "toAccount"}
        onOpenChange={(open) => setSheet(open ? "toAccount" : null)}
        accounts={toAccounts.filter((a) => a.id !== accountId)}
        {...(fundTransfer
          ? {
              ...(newFundHref
                ? {
                    newAccountHref: newFundHref,
                    newLabel: tAccounts("createFund"),
                    onNew: () =>
                      handOver(space.id, {
                        kind,
                        amount,
                        description,
                        when: chosenWhen,
                        ...(accountId ? { accountId } : {}),
                      }),
                  }
                : {}),
              emptyText: tAccounts(newFundHref ? "picker.noFund" : "picker.noFundAsk"),
            }
          : { newAccountHref })}
        value={toAccountId}
        onChoose={(id) => {
          setToAccountId(id);
          clear("toAccount");
        }}
        label={t("form.to")}
      />
      {answer ? <DiscardConfirm kind={kind} answer={answer} /> : null}
      {spaceOpened ? (
        <SpaceSheet
          open={sheet === "space"}
          spaces={spaces}
          currentId={space.id}
          carry={{ kind, amount, description, when: chosenWhen }}
          returnTo={returnTo}
          onClose={() => setSheet(null)}
        />
      ) : null}
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
  );

  // Ruling P291: a new record is a sheet over the screen it was opened from; an edit stays a page (P191).
  return edit ? (
    <div className="flex flex-col gap-3 py-3">
      <ScreenHeader backHref={backHref} title={t("edit.title")} />
      {content}
    </div>
  ) : (
    <RecordSheet backHref={backHref} title={t("form.title")}>
      {content}
    </RecordSheet>
  );
}
