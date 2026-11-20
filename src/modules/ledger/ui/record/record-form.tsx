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
import { AccountPicker, byUse } from "@/modules/accounts/ui";
import { controlsFor, memberLabel } from "@/modules/spaces/ui";
import {
  activeTree,
  categoryPath,
  findCategory,
  groupsForKind,
  LazyCategoryEditor,
  managesCategories,
  type CategoryChoice,
} from "@/modules/categories/ui";
import { Button, ChoiceGroup, Icon, ProblemNotice, ScreenHeader } from "@/shared/ui";
import { useToast } from "@/shared/ui/molecules/toast";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  AccountUsageDto,
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
import {
  decimalOf,
  formatMoney,
  formatNumber,
  formatPercent,
  type Formats,
} from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn } from "@/shared/ui/time/when";
import type { Person } from "../direct/counterparts";
// A type only: no runtime code of the edit modules enters the record route (P191, P198).
import type { RecordInitial } from "../edit/edit-initial";
import { categoryKeyOf, directBodyOf } from "../direct/direct-request";
import {
  forWhomOrder,
  initialForWhom,
  ME,
  myShareOf,
  othersTicked,
  personalRequestOf,
} from "../direct/personal-split";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import { SharedFields } from "../split/shared-fields";
import { useWhoPaidLine } from "../split/who-paid-line";
import type { PersonTransfer, TransferMode } from "./person-transfer";
import { AmountField } from "./amount-field";
import { AccountLegCard } from "./account-leg-card";
import { CurrencyChip } from "./currency-chip";
import { CategoryTiles } from "./category-tiles";
import { useLeaveQuestion } from "@/shared/ui/navigation/hold-navigation";
import { leaveSheet } from "@/shared/ui/navigation/leave-sheet";
import { DiscardConfirm, type HoldNavigation } from "./discard-confirm";
import { FormChip, SummaryRow, OthersAccountRow } from "./form-chip";
import { DescriptionField, MoneyField, RowError } from "./form-rows";
import { Keypad } from "./keypad";
import { RecordSheet } from "./record-sheet";
import { LineWarningConfirm, LineWarningNote } from "./line-warning";
import { accountOfScreen, learnedAccount } from "./desde";
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
import { useExchangeRate } from "./use-exchange-rate";
import { useIdempotencyKey } from "./use-idempotency-key";
import { usePairDebt } from "./use-pair-debt";
import { whenLabel, type When } from "./when-label";

// The sheet's code loads only when someone opens it, so the personal form keeps its script budget (P177).
/** The date and time sheet opens on a tap: it loads beside the form, not in its route (ADR 0004). */
const DateTimeSheet = dynamic(() => import("./date-time-sheet").then((module) => module.DateTimeSheet), {
  ssr: false,
});
/** P331, P333: a personal expense's "¿Quién pagó y para quién?", in a chunk that loads on the first tap. */
const PersonalWhoPaidSheet = dynamic(
  () => import("../split/who-paid-sheets").then((module) => module.PersonalWhoPaidSheet),
  { ssr: false },
);
/** P344 (S4): a fund contribution's "Quién aportó", in the who-paid sheets' chunk. */
const ContributorSheet = dynamic(
  () => import("../split/who-paid-sheets").then((module) => module.ContributorSheet),
  { ssr: false },
);
/** Ruling P291: the category picker of board B1 · 03, in a chunk of its own that loads when it first opens. */
const CategorySheet = dynamic(() => import("./category-sheet").then((module) => module.CategorySheet), {
  ssr: false,
});

/** P334: a transfer to or from someone, its rows and sheets in a chunk that loads when "A alguien" is chosen. */
const PersonTransferRows = dynamic(
  () => import("./person-transfer-rows").then((module) => module.PersonTransferRows),
  { ssr: false },
);

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
  /** Issue #198 (P188): a contribution's fund never changes, so while it stays a transfer its Hacia only shows it. */
  readonly fixedAccounts?: boolean;
  /**
   * P344 (S6): opens on the picker of the editor's own account, when the movement's paying side is theirs: Desde of
   * their contribution, or who paid (which holds Desde) of their shared expense.
   */
  readonly pick?: boolean;
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
  /** The people the recorder shares a space with: a personal expense may be for them too (P172, P331). */
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
  /**
   * Ruling P337 (#334): how much the person used each account lately: "Desde" and the account pickers list the most used
   * first, and an expense's category preselects the account it was last paid from. Without it, by name and last used.
   */
  readonly accountUsage?: AccountUsageDto | null;
  /** P342 (S2): the person's favorite currencies, which the currency sheet lists after the space's. */
  readonly favoriteCurrencies?: readonly string[];
}

/** HU-E9-03, the QuickAdd artboard as a page: amount, description, category, accounts, date and time, Save. */
export function RecordForm({
  space,
  accounts: givenAccounts,
  groups: givenGroups,
  formats,
  initialKind,
  initialNow,
  timeZone,
  profileZone = "UTC",
  shared: givenShared,
  people,
  api: injected,
  edit,
  lineWatch = null,
  returnTo = null,
  holdNavigation,
  spaces = [],
  onCategoryCreated,
  accountUsage = null,
  favoriteCurrencies = [],
}: RecordFormProps) {
  const t = useTranslations("ledger");
  // Ruling P337: the most used accounts first, wherever the form lists them.
  const ranked = accountUsage?.accounts;
  const accounts = useMemo(() => byUse(givenAccounts, ranked), [givenAccounts, ranked]);
  const shared = useMemo(
    () => givenShared && { ...givenShared, myAccounts: byUse(givenShared.myAccounts, ranked) },
    [givenShared, ranked],
  );
  const errors = useTranslations("errors");
  const tAccounts = useTranslations("accounts");
  const names = useTranslations("members");
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
  // P346 (S6): the tree with what the pencil's sheet answered; a fresh read from the route replaces it.
  const [groups, setGroups] = useState(givenGroups);
  const [read, setRead] = useState(givenGroups);
  if (givenGroups !== read) {
    setRead(givenGroups);
    setGroups(givenGroups);
  }
  // P346 (S6): the category the pencil edits, for who manages the tree (the API's `authorizeManager`).
  const [editing, setEditing] = useState<string | null>(null);
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
    const paidFrom = sharedExpense
      ? split?.payer.kind === "ME" || split?.payer.kind === "FOR_FUND"
        ? split.payer.accountId
        : null
      : accountId;
    if (kind === "EXPENSE" && paidFrom) rememberLastAccount(paidFrom);
  };
  // Ruling P321: the account handed over by Crear un fondo; ruling P337: the account whose screen the form was opened
  // from. Either is where the form starts while it is one Desde offers, and a category never changes it.
  const [givenAccount] = useState(() =>
    edit
      ? null
      : ([carried?.accountId, accountOfScreen(returnTo, space.id)].find(
          (id) => id && [...fromAccounts, ...(shared?.myAccounts ?? [])].some((a) => a.id === id),
        ) ?? null),
  );
  const [accountId, setAccountId] = useState<string | null>(() => {
    if (edit) return edit.initial.accountId;
    if (givenAccount && fromAccounts.some((a) => a.id === givenAccount)) return givenAccount;
    return preferredAccountId(fromAccounts, readLastAccount());
  });
  // Ruling P337: once the person picks the account, a category no longer proposes one.
  const [accountPicked, setAccountPicked] = useState(false);
  const [toAccountId, setToAccountId] = useState<string | null>(
    () =>
      edit?.initial.toAccountId ?? (fundTransfer && shared.funds.length === 1 ? shared.funds[0]!.id : null),
  );
  const [chosenWhen, setChosenWhen] = useState<When | null>(edit?.initial.when ?? carried?.when ?? null);
  const [spaceOpened, setSpaceOpened] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(
    edit?.pick && edit.initial.kind === "TRANSFER" && edit.initial.split?.payer.kind === "ME"
      ? "account"
      : null,
  );
  const [sheetNow, setSheetNow] = useState<When>(start);
  const [pending, setPending] = useState(false);
  const [split, setSplit] = useState(
    () =>
      edit?.initial.split ??
      (shared
        ? initialSplitDraft(
            shared,
            givenAccount && shared.myAccounts.some((a) => a.id === givenAccount)
              ? givenAccount
              : preferredAccountId(shared.myAccounts, readLastAccount()),
          )
        : null),
  );
  const [unbuilt, setUnbuilt] = useState<"amount" | "account" | "toAccount" | "payer" | "split" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // P342 (owner: "la moneda del espacio es la que viene siempre por defecto"): an expense's or income's own currency,
  // the space's until the person chooses another; an edit keeps the movement's.
  const [chosenCurrency, setChosenCurrency] = useState(edit?.initial.currency ?? space.currency);
  // P342 (board 4): what the account in another currency moved, as typed, with the pair it was typed for. An edit
  // starts on the stored leg, which gives way to the suggestion once the amount changes unless the person typed it.
  const [leg, setLeg] = useState(() => {
    const stored = edit?.initial.accountLeg;
    return stored
      ? {
          key: `${edit.initial.currency}|${stored.currency}`,
          text: formatNumber(decimalOf(stored.amount, currencyOf(stored.currency).exponent), formats),
        }
      : { key: "", text: "" };
  });
  const [legTouched, setLegTouched] = useState(false);
  const [legTyping, setLegTyping] = useState(false);
  // D29, board 10: what arrives at a cross-currency transfer's destination, in its own currency, sent only when typed.
  const [destAmount, setDestAmount] = useState("");
  // P331, P333: whom a personal expense was for; the recorder alone until they tick someone else.
  const [forWhom, setForWhom] = useState(initialForWhom);
  const [whoOpened, setWhoOpened] = useState(false);
  // The picker brings the dialog's code with it, so it loads on the first tap, not with the form (ADR 0004).
  const [pickerOpened, setPickerOpened] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  // P334: a personal transfer between the recorder's own accounts, or to or from someone.
  const [transfer, setTransfer] = useState<PersonTransfer>({ mode: "OWN", personId: null, placeIndex: 0 });
  const whoPaidLine = useWhoPaidLine();
  const [keylessTried, setKeylessTried] = useState(false);
  // Issue #215: what the person entered or chose, against what the form opened with; leaving asks only while they
  // differ. The default split may change the method by itself (P167), so only who paid and a chosen split count.
  const enteredOf = (typed: unknown[]) =>
    JSON.stringify([...typed, category, accountId, toAccountId, forWhom, split?.payer, split?.chosen]);
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
  // Issue #198 (P188): a contribution's fund never changes; P344 (S3): its Desde may be another member's, or none.
  const fixedAccounts = kind === "TRANSFER" && edit?.fixedAccounts === true;
  // P344 (S4): a contribution's payer, whom its edit may change to another current member.
  const contributorId = fixedAccounts && split && "memberId" in split.payer ? split.payer.memberId : null;
  // P334: to or from someone, only the recorder's account takes part, as an income's does.
  const toSomeone = !edit && space.kind === "PERSONAL" && kind === "TRANSFER" && transfer.mode !== "OWN";
  // P334: only the places in the account's currency.
  const accountCurrency = accounts.find((a) => a.id === accountId)?.balance.currency ?? space.currency;
  const toAccountCurrency = accounts.find((a) => a.id === toAccountId)?.balance.currency ?? space.currency;
  // D29, board 10: an own transfer's amount is what leaves its source account, in that account's currency. P342: an
  // expense or an income is in the currency the person chose, the space's by default, whatever account takes part.
  const amountCurrency =
    kind === "TRANSFER"
      ? accountId !== null && shared === undefined && !toSomeone
        ? accountCurrency
        : space.currency
      : chosenCurrency;
  // P342 (board 4): the one account of the recorder's that pays the expense (alone, for them alone; or as who paid a
  // shared one) or receives the income; when its currency is not the movement's, the card asks what it moved.
  const legAccountId =
    kind === "INCOME" && shared === undefined
      ? accountId
      : kind === "EXPENSE" && shared === undefined
        ? forWhom.payer === ME && forWhom.draft.selected.length === 1
          ? accountId
          : null
        : kind === "EXPENSE" && split?.payer.kind === "ME"
          ? split.payer.accountId
          : null;
  const legAccount = [...accounts, ...(shared?.myAccounts ?? [])].find((a) => a.id === legAccountId);
  const legCurrency =
    legAccount && legAccount.balance.currency !== amountCurrency ? legAccount.balance.currency : null;
  // D29, board 10: a transfer whose destination account is in another currency asks what arrives ("Llega").
  const crossTransfer =
    kind === "TRANSFER" && !toSomeone && toAccountId !== null && amountCurrency !== toAccountCurrency;
  const transferPeople = toSomeone
    ? (people ?? []).map((p) => ({
        ...p,
        places: p.places.filter((place) => place.currency === null || place.currency === accountCurrency),
      }))
    : [];
  const transferPerson = transferPeople.find((p) => p.memberId === transfer.personId);
  // P334: the chosen place's debt between the two, read here so the rows only show it (P127).
  const pairDebt = usePairDebt(
    api,
    transferPerson ? (transferPerson.places[transfer.placeIndex] ?? transferPerson.places[0] ?? null) : null,
  );
  // The typed amount in minor units while it is above zero (the default split refuses 0), whatever else is unbuilt.
  const typed = parseDecimal(amount, formats.numberFormat);
  const minor = typed === null ? null : minorOf(typed, currencyOf(amountCurrency).exponent);
  const positiveMinor = minor !== null && BigInt(minor) > 0n ? minor : null;
  // P342 (board 4): the day's rate of the form's date and the server's conversion of the amount at it, which suggests
  // the leg; what the person typed wins over it.
  const rate = useExchangeRate(
    api,
    legCurrency === null
      ? null
      : { base: amountCurrency, quote: legCurrency, on: when.date, amount: positiveMinor },
  );
  const legKey = legCurrency === null ? null : `${amountCurrency}|${legCurrency}`;
  const legText = leg.key === legKey ? leg.text : "";
  const legDecimal = legCurrency === null ? null : parseDecimal(legText, formats.numberFormat);
  const legTyped =
    legCurrency === null || legDecimal === null
      ? null
      : minorOf(legDecimal, currencyOf(legCurrency).exponent);
  const legMinor =
    legCurrency === null
      ? null
      : legTyped !== null && BigInt(legTyped) > 0n
        ? legTyped
        : rate?.status === "found"
          ? rate.converted
          : null;
  const accountAmountBody =
    legCurrency !== null && legMinor !== null && BigInt(legMinor) > 0n
      ? { amount: legMinor, currency: legCurrency }
      : null;
  // D29, board 10: what arrives at a cross-currency transfer's destination, in its own currency.
  const destTyped = parseDecimal(destAmount, formats.numberFormat);
  const destMinor = destTyped === null ? null : minorOf(destTyped, currencyOf(toAccountCurrency).exponent);
  const destinationBody =
    crossTransfer && destMinor !== null && BigInt(destMinor) > 0n
      ? { amount: destMinor, currency: toAccountCurrency }
      : null;
  const built = toSomeone
    ? requestOf({ ...draft, kind: "INCOME", category: null }, amountCurrency, formats.numberFormat)
    : requestOf(draft, amountCurrency, formats.numberFormat, sharedExpense, {
        // P333: someone else paid a personal expense, so no account of the recorder's is asked for.
        // P344 (S3): a contribution's Desde is its payer's to choose, so it may have none.
        accountless:
          fixedAccounts || (kind === "EXPENSE" && !edit && space.kind === "PERSONAL" && forWhom.payer !== ME),
        ...(accountAmountBody ? { accountAmount: accountAmountBody } : {}),
        ...(destinationBody ? { destinationAmount: destinationBody } : {}),
      });
  // P331, P333: a new personal expense says who paid and whom it was for in one row, so its account row gives way.
  const personalWho = !edit && kind === "EXPENSE" && space.kind === "PERSONAL";
  const known = people ?? [];
  const personal = personalWho
    ? personalRequestOf(forWhom, {
        people: known,
        amount: positiveMinor,
        currency: amountCurrency,
        numberFormat: formats.numberFormat,
      })
    : null;
  // A split with someone is its own request (P172): choosing someone else makes a new draft, so a new key.
  const splitting = personal?.kind === "DIRECT" ? personal : null;
  const { key, renew } = useIdempotencyKey(
    built.ok
      ? JSON.stringify({ body: built.body, direct: splitting, transfer: toSomeone ? transfer : null })
      : "",
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
  // #142 (P235, P236): only an expense of the form's own space, never a split with someone nor an edit.
  const chosenCategory = category ? (category.subcategoryId ?? category.categoryId) : null;
  // Ruling P337: "Bancolombia: con la que sueles pagar Gas." while Desde holds the account the category was last paid from.
  const paysFrom = sharedExpense
    ? split?.payer.kind === "ME" || split?.payer.kind === "FOR_FUND"
      ? split.payer.accountId
      : null
    : accountId;
  const usual =
    kind === "EXPENSE" && !edit
      ? learnedAccount(
          accountUsage,
          chosenCategory,
          sharedExpense && shared ? shared.myAccounts : fromAccounts,
        )
      : null;
  const fromHint =
    usual !== null && usual === paysFrom && chosenCategory !== null
      ? t("who.usual", {
          account: nameOf(usual) ?? "",
          category: findCategory(groups, chosenCategory)?.category.name ?? "",
        })
      : null;
  // P342: a plan's lines are in the space's currency, so only an expense in it is weighed against them.
  const warning =
    kind === "EXPENSE" && !splitting && !edit && amountCurrency === space.currency
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
    positiveMinor ? formatMoney({ amount: positiveMinor, currency: amountCurrency }, formats) : null,
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
  // In a shared expense the account an API problem names is the payer's; with no card, a leg's problem is the form's.
  const where =
    sharedExpense && found === "account"
      ? "payer"
      : found === "accountAmount" && legCurrency === null
        ? "form"
        : found;
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
    // P342: a leg the person never typed in this form (an edit's stored one) gives way to the new amount's suggestion.
    if (!legTouched && leg.text !== "") setLeg({ key: "", text: "" });
  };
  // The split and who paid share their rows: either one changing clears both, and the account an API problem names.
  const changeSplit = useCallback(
    (next: NonNullable<typeof split>) => {
      setSplit(next);
      clear("split", "payer", "account");
    },
    [clear],
  );
  // Ruling P337: an expense's category preselects the account the person last paid it from, in Desde or as the account
  // they pay from in a shared space, until they pick one themselves or the form was given one.
  const chooseCategory = (choice: CategoryChoice) => {
    setCategory(choice);
    clear("category");
    if (edit || kind !== "EXPENSE" || givenAccount !== null || !choice) return;
    const leaf = choice.subcategoryId ?? choice.categoryId;
    const learned = learnedAccount(accountUsage, leaf, fromAccounts);
    if (learned && !accountPicked) setAccountId(learned);
    const mine = shared ? learnedAccount(accountUsage, leaf, shared.myAccounts) : null;
    if (mine && split && !split.payerChosen && (split.payer.kind === "ME" || split.payer.kind === "FOR_FUND"))
      setSplit({ ...split, payer: { ...split.payer, accountId: mine } });
  };

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
        const failed = await edit.onSave(
          {
            kind: built.kind,
            body: contributorId ? { ...built.body, payerMemberId: contributorId } : built.body,
          },
          { when },
        );
        if (failed) {
          setProblem(failed);
          setPending(false);
        }
        return;
      }
      // P334: a settlement with the person, in the space chosen for it (their direct space made on first use).
      if (toSomeone && transferPerson) {
        // Loaded on save, so the record route's own script does not carry it (ADR 0004).
        const { personTransferRequest } = await import("./person-transfer");
        const request = personTransferRequest(transfer, transferPerson, {
          ...built.body,
          accountId: built.body.accountId,
        });
        const sent =
          request.path === "space"
            ? await api.POST("/api/v1/spaces/{spaceId}/settlements", {
                params: { path: { spaceId: request.spaceId }, header: { "idempotency-key": key } },
                body: request.body as never,
              })
            : await api.POST("/api/v1/direct-settlements", {
                params: { header: { "idempotency-key": key } },
                body: request.body as never,
              });
        if (sent.response.ok && sent.data) {
          renew();
          const saved = sent.data as { id?: string; spaceId?: string; settlement?: { id: string } };
          const savedIn = request.path === "space" ? request.spaceId : saved.spaceId!;
          savedToast("TRANSFER", savedIn, saved.settlement?.id ?? saved.id);
          leaveSheet(router, afterSaveUrl(savedIn, undefined, returnTo), () => router.refresh());
          return;
        }
        setProblem(problemFrom(sent.error, sent.response));
        setPending(false);
        return;
      }
      if (splitting && categoryKey !== null) {
        const { data, error, response } = await api.POST("/api/v1/direct-splits", {
          params: { header: { "idempotency-key": key } },
          body: directBodyOf(
            built.body,
            splitting.counterpart,
            categoryKey,
            splitting.parts,
            splitting.paidBy,
          ) as never,
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
  // P344 (S3): another member's contribution, whose Desde only they choose.
  const contributor = fixedAccounts && split?.payer.kind === "MEMBER" ? split.payer.memberId : null;
  const memberOf = (id: string) => shared?.members.find((m) => m.id === id);
  const meUserId = memberOf(shared?.meMemberId ?? "")?.userId ?? "";
  const payer = contributorId === null ? undefined : memberOf(contributorId);
  // P333 (board "Registrar: una fila"): "Pagaste tú con Bancolombia · para Juan y Ana".
  // P333: "Pagó Juan · le debes 60.000 COP" when someone else paid.
  const otherPayer =
    forWhom.payer === ME
      ? null
      : (known.find((p) => p.memberId === forWhom.payer)?.name ??
        forWhom.guests.find((g) => g.id === forWhom.payer)?.name ??
        "");
  const myShare =
    otherPayer === null
      ? null
      : myShareOf(forWhom, {
          people: known,
          amount: positiveMinor,
          currency: amountCurrency,
          numberFormat: formats.numberFormat,
        });
  const personalLine = whoPaidLine({
    payer:
      otherPayer === null
        ? { kind: "ME", account: nameOf(accountId) }
        : { kind: "OTHER", name: otherPayer, owesThem: true },
    meIncluded: forWhom.draft.selected.includes(ME),
    others: othersTicked(forWhom, known).map((other) => other.name),
    myShare: myShare === null ? null : formatMoney({ amount: myShare, currency: amountCurrency }, formats),
  });

  // Ruling P333: who paid and whom it was for are one summary row, always on screen, so a problem in it is never folded
  // away (it replaced Más opciones, issue #171, and P324's two rows).
  const sharedRows = Boolean(sharedExpense && shared && split);
  const chipErrors = (["account", "toAccount", "when"] as const).flatMap((field) => {
    const error = errorOf(field);
    return error ? [{ field, error }] : [];
  });
  const backHref = edit?.backHref ?? safeReturnTo(returnTo) ?? `/spaces/${space.id}`;
  const offeredGroups = kind === "TRANSFER" ? [] : groupsForKind(live, kind);
  // P342: the amount field and keypad take the movement's currency (D29: an own transfer's source account's).
  const currency = currencyOf(amountCurrency);

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
          {kind === "TRANSFER" ? null : (
            <CurrencyChip
              value={amountCurrency}
              space={space}
              favorites={favoriteCurrencies}
              title={t(`form.currency.title.${kind}`)}
              onChoose={(code) => {
                setChosenCurrency(code);
                clear("amount", "accountAmount");
              }}
            />
          )}
          <AmountField
            value={amount}
            onChange={changeAmount}
            currency={amountCurrency}
            numberFormat={formats.numberFormat}
            exponent={currency.exponent}
            error={errorOf("amount")}
            autoFocus
            selectOnOpen={edit !== undefined}
            onWholeSelected={setReplacing}
          />
          {legCurrency !== null && legAccount && (kind === "EXPENSE" || kind === "INCOME") ? (
            <AccountLegCard
              kind={kind}
              account={legAccount.name}
              movementCurrency={amountCurrency}
              currency={legCurrency}
              shown={legMinor}
              rate={rate}
              value={legText}
              onChange={(next) => {
                setLeg({ key: legKey ?? "", text: next });
                setLegTouched(true);
                clear("accountAmount");
              }}
              typing={legTyping || rate?.status === "missing" || errorOf("accountAmount") !== undefined}
              onType={() => {
                setLegTyping(true);
                // The field appears where the button was; the focus follows it once it is drawn.
                requestAnimationFrame(() => document.getElementById("record-account-amount")?.focus());
              }}
              error={errorOf("accountAmount")}
              formats={formats}
            />
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
          {/* P334 (board "Transferencia a alguien"): the recorder's own accounts, to someone or from someone. */}
          {kind === "TRANSFER" && !edit && space.kind === "PERSONAL" ? (
            <ChoiceGroup
              layout="chips"
              label={t("personTransfer.mode")}
              value={transfer.mode}
              onValueChange={(mode: TransferMode) =>
                setTransfer((current) => ({
                  ...current,
                  mode,
                  personId: current.personId ?? people?.[0]?.memberId ?? null,
                }))
              }
              options={(["OWN", "TO", "FROM"] as const).map((mode) => ({
                value: mode,
                label: t(`personTransfer.modes.${mode}`),
              }))}
            />
          ) : null}
          {kind === "TRANSFER" ? null : (
            <CategoryTiles
              groups={groups}
              offered={offeredGroups}
              recent={offered}
              value={category}
              onChoose={chooseCategory}
              onMore={() => {
                setPickerOpened(true);
                setSheet("category");
              }}
              onEdit={managesCategories(space.role) ? setEditing : undefined}
              error={errorOf("category")}
            />
          )}
          {/* Ruling P324 (S5, board "Registrar gasto"), amended by P333: flat summary rows, each opening its sheet: who
              paid and for whom, and the date. A row that does not apply to the kind or space is not drawn. */}
          <div className="flex flex-col">
            {/* A shared expense names who paid instead of one account (P168). Never unmounted while it applies (P167). */}
            {sharedRows && shared && split ? (
              <SharedFields
                context={shared}
                draft={split}
                onChange={changeSplit}
                amount={positiveMinor}
                currency={amountCurrency}
                formats={formats}
                title={sharedTitle}
                spaceId={space.id}
                categoryId={category ? (category.subcategoryId ?? category.categoryId) : null}
                date={when.date}
                api={api}
                error={errorOf("split")}
                payerError={errorOf("payer")}
                defaultSplit={!edit}
                forFund={!edit}
                fromHint={fromHint}
                openOnLoad={edit?.pick === true && split.payer.kind === "ME"}
              />
            ) : null}
            <div role="group" aria-label={t("form.details")} className="flex flex-col">
              {personalWho ? (
                <SummaryRow
                  value={personalLine}
                  meta={t("split.title")}
                  wrap
                  onClick={() => {
                    setWhoOpened(true);
                    setWhoOpen(true);
                  }}
                  errorId={errorOf("account") ? "record-account-error" : undefined}
                />
              ) : toSomeone ? (
                <PersonTransferRows
                  people={transferPeople}
                  transfer={transfer}
                  onChange={setTransfer}
                  accountName={nameOf(accountId)}
                  onPickAccount={() => setSheet("account")}
                  accountError={errorOf("account")}
                  amount={positiveMinor}
                  currency={space.currency}
                  formats={formats}
                  debt={pairDebt}
                  Row={SummaryRow}
                />
              ) : sharedRows ? null : (
                <>
                  {shared && contributorId !== null ? (
                    <SummaryRow
                      // A payer who left the space is no current member, so the row names none until one is chosen.
                      value={payer ? memberLabel(payer, meUserId, names) : ""}
                      meta={t("edit.contributor")}
                      onClick={() => {
                        setWhoOpened(true);
                        setWhoOpen(true);
                      }}
                    />
                  ) : null}
                  {contributor !== null ? (
                    // P344 (S3): another member's contribution: Desde is theirs, and only they choose it.
                    <OthersAccountRow name={payer?.displayName ?? ""} assigned={accountId !== null} />
                  ) : (
                    accountRow("account", accountLabel, nameOf(accountId), "account", t("form.chooseAccount"))
                  )}
                </>
              )}
              {kind === "TRANSFER" && !toSomeone
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
            {/* D29, board 10: a transfer whose destination is in another currency asks what arrives there ("Llega"),
                in the destination's own currency; the amount above is what leaves the source ("Sale"). */}
            {crossTransfer ? (
              <div className="mt-3">
                <MoneyField
                  id="record-arrives"
                  numberFormat={formats.numberFormat}
                  exponent={currencyOf(toAccountCurrency).exponent}
                  currency={toAccountCurrency}
                  label={t("form.arrives")}
                  hint={t("form.arrivesHint")}
                  value={destAmount}
                  onChange={(next) => {
                    setDestAmount(next);
                    clear("toAccount");
                  }}
                />
              </div>
            ) : null}
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
            disabled={
              pending ||
              (!built.ok && built.field === "split") ||
              (personal?.kind === "INVALID" && positiveMinor !== null) ||
              (toSomeone && !transferPerson)
            }
            aria-describedby={warning ? "record-line-warning" : undefined}
          >
            {edit ? t("edit.save") : t(`form.save.${kind}`)}
          </Button>
        </div>
      )}
      {whoOpened && personalWho ? (
        <PersonalWhoPaidSheet
          open={whoOpen}
          onOpenChange={setWhoOpen}
          title={sharedTitle}
          accounts={accounts}
          accountId={accountId}
          onAccount={(id) => {
            setAccountId(id);
            setAccountPicked(true);
            clear("account");
          }}
          people={known}
          newAccountHref={newAccountHref}
          fromHint={fromHint}
          forWhom={forWhom}
          onForWhom={setForWhom}
          meId={ME}
          memberIds={forWhomOrder(known, forWhom.guests)}
          amount={positiveMinor}
          currency={amountCurrency}
          formats={formats}
        />
      ) : null}
      {whoOpened && shared && contributorId !== null ? (
        <ContributorSheet
          open={whoOpen}
          onOpenChange={setWhoOpen}
          context={shared}
          initial={edit!.initial}
          value={contributorId}
          onChoose={(chosen, from) => {
            changeSplit({ ...split!, payer: chosen });
            setAccountId(from);
          }}
        />
      ) : null}
      {editing ? (
        <LazyCategoryEditor
          spaceId={space.id}
          groups={groups}
          categoryId={editing}
          api={api}
          onClose={() => setEditing(null)}
          onChange={setGroups}
          onRemoved={(id) =>
            // P346 (S6): a category archived or deleted from the sheet is no longer the form's choice.
            setCategory((current) =>
              current?.categoryId === id
                ? null
                : current?.subcategoryId === id
                  ? { categoryId: current.categoryId, subcategoryId: null }
                  : current,
            )
          }
        />
      ) : null}
      {kind === "TRANSFER" || !pickerOpened ? null : (
        <CategorySheet
          open={sheet === "category"}
          onOpenChange={(open) => setSheet(open ? "category" : null)}
          groups={offeredGroups}
          value={category}
          recent={offered}
          onChoose={chooseCategory}
          space={space}
          {...(onCategoryCreated
            ? {
                creation: {
                  api,
                  kind,
                  onCreated: (made: CategoryDto) => {
                    onCategoryCreated(made);
                    chooseCategory({ categoryId: made.id, subcategoryId: null });
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
          setAccountPicked(true);
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
