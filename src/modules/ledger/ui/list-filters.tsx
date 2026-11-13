"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { categoryPath, findCategory } from "@/modules/categories/ui";
import { Button, Icon, usePeriodText } from "@/shared/ui";
import type { AccountDto, CategoryGroupDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { hrefOf, type ListFilter, type ListSpace, type TransactionKind } from "./list-href";
import type { FilterRow, ListSheet } from "./list-sheets";

// Ruling P277: the chips' sheets load on the first tap, so the list's script stays within its budget (ADR 0004).
const ListSheets = dynamic(() => import("./list-sheets").then((module) => module.ListSheets), { ssr: false });

/** How long the search waits for the person to stop typing before it asks again. */
const SEARCH_PAUSE_MS = 400;

/** A removable chip of an active filter, whether a button or a link. */
const CHIP =
  "inline-flex h-11 shrink-0 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink [overflow-wrap:anywhere]";

/**
 * Ruling P324 (#309, board "Movimientos", densidad media): one summary line (the period and its totals), the search
 * behind its icon, and every filter behind one Filtros button whose sheet opens each filter's own (P277): the period,
 * the space (P319), Categoría, Cuenta, Tipo and who paid (#148), and the recurring movements (P270). An active filter
 * is never hidden: the button counts them, and each shows under the summary as a pressed chip that removes it. N8: a
 * period is a place, so choosing one pushes; a filter only narrows the place, so it replaces the entry.
 */
export function ListFilters({
  spaceId,
  summary,
  period,
  previous,
  next,
  periods,
  today,
  filter,
  groups,
  accounts = [],
  accountNames = {},
  periodPolicy,
  formats,
  memberNames = {},
  movedMemberIds,
  spaces,
}: {
  readonly spaceId: string;
  /** The period's totals, read after its name on the summary line. */
  readonly summary: ReactNode;
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  /** The space's recent periods; the sheet offers those up to today, with the shown period's neighbours. */
  readonly periods?: readonly PeriodDto[] | undefined;
  readonly today: string;
  readonly filter: ListFilter;
  readonly groups: CategoryGroupDto[];
  readonly accounts?: readonly AccountDto[];
  readonly accountNames?: Readonly<Record<string, string>>;
  /** Issue #178: with the space's policy the period is named as the Plan names it ("octubre 2026", P205). */
  readonly periodPolicy?: SpaceDto["periodPolicy"] | undefined;
  readonly formats: Pick<Formats, "dateFormat">;
  /** Issue #148: a shared space's members, by id; with two or more the list can be filtered by who paid. */
  readonly memberNames?: Readonly<Record<string, string>>;
  /**
   * #217 (P263): the members any movement ever touched. The others are left out of the filter, except the one already
   * chosen; without it every member is offered.
   */
  readonly movedMemberIds?: readonly string[] | undefined;
  /**
   * Ruling P319: the person's current spaces, personal first, when the list gathers them all: the space chip offers
   * them, Tipo offers payments between members, and Categoría groups its categories by space while several are shown.
   * `groups` and `accounts` are then the shown spaces' own.
   */
  readonly spaces?: readonly ListSpace[] | undefined;
}) {
  const t = useTranslations("ledger");
  const periodText = usePeriodText();
  const router = useRouter();
  const [sheet, setSheet] = useState<ListSheet | null>(null);
  // Once a sheet opened its chunk stays on, so a sheet closes with its own animation.
  const [opened, setOpened] = useState(false);
  const open = (name: ListSheet) => () => {
    setOpened(true);
    setSheet(name);
  };
  const narrow = (change: Partial<ListFilter>) => router.replace(hrefOf(spaceId, { ...filter, ...change }));
  const nameOf = (p: PeriodDto) =>
    periodPolicy ? periodText(p, periodPolicy, formats) : t("list.period", { label: p.label });
  const shown = spaces?.filter((s) => filter.spaceId === undefined || s.id === filter.spaceId) ?? [];
  const shared = Object.keys(memberNames).length > 0 || shown.some((s) => s.kind !== "PERSONAL");
  const kinds: TransactionKind[] = [
    "EXPENSE",
    "INCOME",
    "TRANSFER",
    ...(shared ? (["SETTLEMENT"] as const) : []),
  ];
  const live = accounts.filter((a) => a.archivedAt === null);
  const payers = Object.entries(memberNames).filter(
    ([id]) => movedMemberIds === undefined || movedMemberIds.includes(id) || id === filter.payerMemberId,
  );
  // The periods up to today, and the shown one's neighbours whatever their dates, newest first.
  const choices = [
    ...new Map(
      [...(periods ?? []).filter((p) => p.startDate <= today), next, period, previous]
        .filter((p): p is PeriodDto => p !== null)
        .map((p) => [p.label, p]),
    ).values(),
  ].sort((a, b) => b.startDate.localeCompare(a.startDate));
  // Ruling P319: another space keeps the category and the account chosen only when they are its own.
  const toSpace = (space: ListSpace | undefined): Partial<ListFilter> => {
    const kept = space ?? { groups, accounts };
    const category = filter.categoryId?.split(",")[0];
    return {
      spaceId: space?.id,
      categoryId: category && findCategory(kept.groups, category) ? filter.categoryId : undefined,
      accountId: kept.accounts.some((a) => a.id === filter.accountId) ? filter.accountId : undefined,
    };
  };
  const chosenSpace = spaces?.find((s) => s.id === filter.spaceId);
  // Ruling P310: Inicio opens a category with its subcategories ("id,sub,…"); the chip names the first, the category.
  const category = filter.categoryId ? categoryPath(groups, filter.categoryId.split(",")[0]!) : null;
  const account = filter.accountId ? (accountNames[filter.accountId] ?? null) : null;
  const type = filter.type ? t(`type.${filter.type}`) : null;
  const payer = filter.payerMemberId ? (memberNames[filter.payerMemberId] ?? null) : null;
  // The Filtros sheet's rows, in the board's order: period, space, category, account, type.
  const rows: FilterRow[] = [
    ["period", nameOf(period)],
    ...(spaces ? [["space", chosenSpace?.name ?? t("list.allSpaces")] as const] : []),
    ["category", category],
    ...(live.length > 0 || filter.accountId ? [["account", account] as const] : []),
    ["type", type],
  ];
  const remove = (name: string, clear: Partial<ListFilter>): ReactNode => (
    <Button
      key={name}
      variant="secondary"
      aria-pressed="true"
      aria-label={t("list.removeFilter", { name })}
      size="chip"
      onClick={() => narrow(clear)}
    >
      {name} ✕
    </Button>
  );
  // What narrows the list now, each removable; a payer stays a link, as choosing one is (#148).
  const chips = [
    chosenSpace ? remove(chosenSpace.name, { spaceId: undefined }) : null,
    category ? remove(category, { categoryId: undefined }) : null,
    account ? remove(account, { accountId: undefined }) : null,
    type ? remove(type, { type: undefined }) : null,
    payer ? (
      <Link
        key="payer"
        href={hrefOf(spaceId, { ...filter, payerMemberId: undefined })}
        aria-label={t("list.removeFilter", { name: payer })}
        className={CHIP}
      >
        {payer} ✕
      </Link>
    ) : null,
  ].filter((chip) => chip !== null);
  const searched = Boolean(filter.search);
  // The field stays out until the person asks for it; a search in the address, or one she started, keeps it shown.
  const [searching, setSearching] = useState(searched);
  const [focusSearch, setFocusSearch] = useState(false);
  if (searched && !searching) setSearching(true);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 text-sm text-muted">
          <span className="inline-block first-letter:uppercase">{nameOf(period)}</span> · {summary}
        </div>
        <button
          type="button"
          aria-label={t("list.search")}
          aria-expanded={searching}
          onClick={() => {
            setFocusSearch(true);
            setSearching(searched || !searching);
          }}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink"
        >
          <Icon name="search" size={22} />
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={open("filters")}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[15px] font-semibold text-ink"
        >
          <Icon name="sliders" size={18} />
          {chips.length > 0 ? t("list.filtersCount", { count: chips.length }) : t("list.filters")}
        </button>
      </div>
      {searching ? (
        <SearchField
          label={t("list.search")}
          clearLabel={t("list.clearSearch")}
          value={filter.search ?? ""}
          focus={focusSearch}
          onSearch={(search) => narrow({ search: search || undefined })}
        />
      ) : null}
      {chips.length > 0 ? <div className="flex flex-wrap gap-2">{chips}</div> : null}
      {opened ? (
        <ListSheets
          sheet={sheet}
          onSheet={setSheet}
          rows={rows}
          payers={
            payers.length > 1
              ? [["", t("list.anyone")] as const, ...payers].map(([id, name]) => ({
                  id,
                  name,
                  href: hrefOf(spaceId, { ...filter, payerMemberId: id || undefined }),
                  current: (filter.payerMemberId ?? "") === id,
                }))
              : []
          }
          recurringHref={`/spaces/${spaceId}/recurrences`}
          periods={choices.map((p) => ({
            label: p.label,
            name: nameOf(p),
            href: hrefOf(spaceId, { ...filter, period: p.label }),
            current: p.label === period.label,
          }))}
          groups={groups}
          {...(shown.length > 1 ? { categorySpaces: shown } : {})}
          {...(spaces
            ? {
                spaces,
                spaceId: filter.spaceId,
                onSpace: (id: string | undefined) => narrow(toSpace(spaces.find((s) => s.id === id))),
              }
            : {})}
          accounts={live.map((a) => [a.id, a.name] as const)}
          kinds={kinds.map((kind) => [kind, t(`type.${kind}`)] as const)}
          onNarrow={narrow}
        />
      ) : null}
    </div>
  );
}

/**
 * Ruling P277: asks once the person pauses typing, or at once on Enter; blank asks for everything again. Opened from
 * its icon (P324), it takes the focus.
 */
function SearchField({
  label,
  clearLabel,
  value,
  focus,
  onSearch,
}: {
  readonly label: string;
  readonly clearLabel: string;
  readonly value: string;
  readonly focus: boolean;
  readonly onSearch: (search: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  // The searches the field asked for that have not answered yet, in order: an answer to one of them, even one that
  // arrives after the person typed on, never overwrites the field.
  const [pending, setPending] = useState<readonly string[]>([]);
  // What was last asked for, so a pause after Enter, or the answer's own address, asks nothing again.
  const asked = useRef(value);
  const latest = useRef(onSearch);
  const wanted = text.trim();
  if (shown !== value) {
    setShown(value);
    const answered = pending.indexOf(value);
    if (answered >= 0) {
      // The field's own search answered, and so did every one asked before it.
      setPending(pending.slice(answered + 1));
    } else {
      // An address the field did not write (back, a link) shows its own search.
      setPending([]);
      if (value !== wanted) setText(value);
    }
  }
  const ask = useCallback((search: string) => {
    if (search === asked.current) return;
    asked.current = search;
    setPending((before) => [...before, search]);
    latest.current(search);
  }, []);
  useEffect(() => {
    latest.current = onSearch;
  });
  useEffect(() => {
    asked.current = value;
  }, [value]);
  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);
  useEffect(() => {
    const timer = setTimeout(() => ask(wanted), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [ask, wanted]);
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        ask(wanted);
      }}
      className="flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-4 focus-within:border-accent"
    >
      <Icon name="search" size={20} className="shrink-0 text-muted" />
      <input
        type="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder={label}
        value={text}
        ref={input}
        onChange={(event) => setText(event.target.value)}
        // The browser's own clear button is small and off the palette: the field draws a full one instead.
        className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text !== "" ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            setText("");
            ask("");
            input.current?.focus();
          }}
          className="-mr-3 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
        >
          <Icon name="close" size={20} />
        </button>
      ) : null}
    </form>
  );
}
