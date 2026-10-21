"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Tabs } from "radix-ui";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AccountPicker } from "@/modules/accounts/ui";
import { activeTree, CategoryPicker, categoryPath, type CategoryChoice } from "@/modules/categories/ui";
import { Button, Icon, ProblemNotice, ScreenHeader, TextField } from "@/shared/ui";
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
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { nowIn } from "@/shared/ui/time/when";
import type { Person } from "../direct/counterparts";
import { categoryKeyOf, directBodyOf, type DirectChoice } from "../direct/direct-request";
import { initialSplitDraft, type SharedExpenseContext } from "../split/shared-context";
import { SharedFields } from "../split/shared-fields";
import { AmountField } from "./amount-field";
import { DateTimeSheet } from "./date-time-sheet";
import { afterSaveUrl, recordFieldOf, requestOf, type RecordField, type RecordKind } from "./record-request";
import { useIdempotencyKey } from "./use-idempotency-key";
import { whenLabel, type When } from "./when-label";

// The sheet's code loads only when someone opens it, so the personal form keeps its script budget (P177).
const SplitWithPersonSheet = dynamic(
  () => import("../direct/split-with-person-sheet").then((module) => module.SplitWithPersonSheet),
  { ssr: false },
);

const KINDS = ["EXPENSE", "INCOME", "TRANSFER"] as const;

type Sheet = "category" | "account" | "toAccount" | "when" | null;

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
}: RecordFormProps) {
  const t = useTranslations("ledger");
  const errors = useTranslations("errors");
  const router = useRouter();
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

  const [kind, setKind] = useState<RecordKind>(initialKind);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CategoryChoice>(null);
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [chosenWhen, setChosenWhen] = useState<When | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetNow, setSheetNow] = useState<When>(start);
  const [pending, setPending] = useState(false);
  const [split, setSplit] = useState(() => (shared ? initialSplitDraft(shared) : null));
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
  const canSplit = people !== undefined && kind === "EXPENSE" && space.kind === "PERSONAL";
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
  const sharedTitle = [
    description.trim() ||
      (category ? categoryPath(live, category.subcategoryId ?? category.categoryId) : null),
    positiveMinor ? formatMoney({ amount: positiveMinor, currency: space.currency }, formats) : null,
    space.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const found = problem ? recordFieldOf(problem) : null;
  // In a shared expense the account an API problem names is the payer's.
  const where = sharedExpense && found === "account" ? "payer" : found;
  const errorOf = (field: RecordField): string | undefined => {
    // A category of the person's own cannot travel to the direct space; none chosen is asked for as usual.
    if (field === "category" && keylessTried && splitting && categoryKey === null)
      return category === null ? errors("CategoryRequired") : t("direct.noKey");
    if (unbuilt === field)
      return field === "amount"
        ? t("form.amountUnreadable", { example: formatNumber("85000", formats) })
        : t("form.accountRequired");
    return problem && where === field ? messageOf(problem).message : undefined;
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
    setPending(true);
    try {
      if (splitting && categoryKey !== null) {
        const { data, error, response } = await api.POST("/api/v1/direct-splits", {
          params: { header: { "idempotency-key": key } },
          body: directBodyOf(built.body, splitting, categoryKey) as never,
        });
        if (response.ok && data) {
          renew();
          const split = data as DirectSplitDto;
          router.push(afterSaveUrl(split.spaceId, split.expense.warnings));
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
        const warnings =
          built.kind === "EXPENSE" ? (data as RecordedExpenseDto | undefined)?.warnings : undefined;
        router.push(afterSaveUrl(space.id, warnings));
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const picker = (
    field: RecordField,
    name: string,
    value: string | null,
    open: Sheet,
    placeholder: string,
  ): ReactNode => {
    const error = errorOf(field);
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setSheet(open)}
          aria-describedby={error ? `record-${field}-error` : undefined}
          className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-field bg-surface px-4 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm text-muted">{name}</span>
            <span className="font-medium text-ink">{value ?? placeholder}</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
        {error ? (
          <p id={`record-${field}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5 py-4">
      <ScreenHeader backHref={`/spaces/${space.id}`} title={t("form.title")} />
      <form
        data-ready={client ? "true" : undefined}
        onSubmit={(event) => void submit(event)}
        noValidate
        className="flex flex-col gap-5"
      >
        <Tabs.Root value={kind} onValueChange={(next) => setKind(next as RecordKind)}>
          <Tabs.List aria-label={t("form.kind")} className="flex rounded-[14px] bg-track p-1">
            {KINDS.map((k) => (
              <Tabs.Trigger
                key={k}
                value={k}
                className="min-h-11 flex-1 rounded-[10px] text-sm font-medium text-ink data-[state=active]:bg-surface data-[state=active]:shadow"
              >
                {t(`type.${k}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value={kind} className="mt-5 flex flex-col gap-5" tabIndex={-1}>
            <AmountField
              value={amount}
              onChange={setAmount}
              symbol={currencyOf(space.currency).symbol}
              error={errorOf("amount")}
            />
            <TextField
              id="record-description"
              label={t("form.description")}
              autoComplete="off"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              error={errorOf("description")}
            />
            {kind === "TRANSFER"
              ? null
              : picker(
                  "category",
                  t("form.category"),
                  category ? categoryPath(live, category.subcategoryId ?? category.categoryId) : null,
                  "category",
                  t("form.chooseCategory"),
                )}
            {sharedExpense && shared && split ? (
              <SharedFields
                context={shared}
                draft={split}
                onChange={setSplit}
                amount={positiveMinor}
                currency={space.currency}
                formats={formats}
                title={sharedTitle}
                spaceId={space.id}
                categoryId={category ? (category.subcategoryId ?? category.categoryId) : null}
                date={when.date}
                api={api}
                error={errorOf("split") ?? errorOf("payer")}
              />
            ) : (
              picker(
                "account",
                t(
                  kind === "TRANSFER"
                    ? "form.from"
                    : kind === "INCOME"
                      ? "form.receivingAccount"
                      : "form.account",
                ),
                nameOf(accountId),
                "account",
                t("form.chooseAccount"),
              )
            )}
            {canSplit ? (
              direct ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-4">
                  <span className="min-w-0 py-2 font-medium break-words text-accent">
                    {t("direct.with", { name: direct.kind === "MEMBER" ? direct.name : direct.displayName })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("direct.remove", {
                      name: direct.kind === "MEMBER" ? direct.name : direct.displayName,
                    })}
                    onClick={() => setDirect(null)}
                  >
                    <Icon name="close" />
                  </Button>
                </div>
              ) : (
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
              )
            ) : null}
            {kind === "TRANSFER"
              ? picker("toAccount", t("form.to"), nameOf(toAccountId), "toAccount", t("form.chooseAccount"))
              : null}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                data-testid="when-chip"
                aria-label={t("form.when", { label })}
                aria-describedby={errorOf("when") ? "record-when-error" : undefined}
                onClick={() => {
                  setSheetNow(nowIn(new Date(), zone));
                  setSheet("when");
                }}
                className="flex min-h-11 items-center gap-2 self-start rounded-full bg-accent-soft px-4 text-sm font-medium text-accent"
              >
                <Icon name="calendar" size={18} />
                {label}
              </button>
              {errorOf("when") ? (
                <p id="record-when-error" className="text-sm text-danger">
                  {errorOf("when")}
                </p>
              ) : null}
            </div>
          </Tabs.Content>
        </Tabs.Root>
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
        <Button type="submit" size="lg" disabled={pending || (!built.ok && built.field === "split")}>
          {t(`form.save.${splitting ? "DIRECT" : kind}`)}
        </Button>
        {directOpened && people ? (
          <SplitWithPersonSheet
            open={directOpen}
            onOpenChange={setDirectOpen}
            people={people}
            currency={space.currency}
            onChoose={setDirect}
          />
        ) : null}
        <CategoryPicker
          open={sheet === "category"}
          onOpenChange={(open) => setSheet(open ? "category" : null)}
          groups={live}
          value={category}
          onChoose={setCategory}
        />
        <AccountPicker
          open={sheet === "account"}
          onOpenChange={(open) => setSheet(open ? "account" : null)}
          accounts={accounts}
          value={accountId}
          onChoose={(id) => {
            setAccountId(id);
            if (id === toAccountId) setToAccountId(null);
          }}
          label={t(
            kind === "TRANSFER" ? "form.from" : kind === "INCOME" ? "form.receivingAccount" : "form.account",
          )}
        />
        <AccountPicker
          open={sheet === "toAccount"}
          onOpenChange={(open) => setSheet(open ? "toAccount" : null)}
          accounts={accounts.filter((a) => a.id !== accountId)}
          value={toAccountId}
          onChoose={setToAccountId}
          label={t("form.to")}
        />
        <DateTimeSheet
          open={sheet === "when"}
          onOpenChange={(open) => setSheet(open ? "when" : null)}
          value={when}
          now={sheetNow}
          today={today}
          formats={formats}
          onApply={setChosenWhen}
        />
      </form>
    </div>
  );
}
