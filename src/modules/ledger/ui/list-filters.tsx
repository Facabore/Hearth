"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { categoryPath } from "@/modules/categories/ui";
import { Button, Icon, usePeriodText } from "@/shared/ui";
import type { AccountDto, CategoryGroupDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { hrefOf, type ListFilter, type TransactionKind } from "./list-href";
import type { ListSheet } from "./list-sheets";

// Ruling P277: the chips' sheets load on the first tap, so the list's script stays within its budget (ADR 0004).
const ListSheets = dynamic(() => import("./list-sheets").then((module) => module.ListSheets), { ssr: false });

/** How long the search waits for the person to stop typing before it asks again. */
const SEARCH_PAUSE_MS = 400;

const CHIP = "flex h-11 shrink-0 items-center gap-1 rounded-full px-4 text-sm font-semibold";

/**
 * HU-E9-03, board B1 06 (ruling P277): the search, then the period chip and the Categoría, Cuenta and Tipo filters. N8:
 * a period is a place, so choosing one pushes; a filter only narrows the place, so it replaces the entry. A chosen
 * filter reads as a pressed chip that removes it.
 */
export function ListFilters({
  spaceId,
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
}: {
  readonly spaceId: string;
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
  const shared = Object.keys(memberNames).length > 0;
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
  const chip = (
    name: string,
    open: () => void,
    chosen: string | null,
    clear: Partial<ListFilter>,
  ): ReactNode =>
    chosen ? (
      <Button
        variant="secondary"
        aria-pressed="true"
        aria-label={t("list.removeFilter", { name: chosen })}
        size="chip"
        onClick={() => narrow(clear)}
      >
        {chosen} ✕
      </Button>
    ) : (
      <Button variant="secondary" size="chip" onClick={open}>
        {name}
      </Button>
    );
  const category = filter.categoryId ? categoryPath(groups, filter.categoryId) : null;
  return (
    <div className="flex flex-col gap-3">
      <SearchField
        label={t("list.search")}
        value={filter.search ?? ""}
        onSearch={(search) => narrow({ search: search || undefined })}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={open("period")}
          className={`${CHIP} bg-ink text-bg`}
        >
          <span className="inline-block first-letter:uppercase">{nameOf(period)}</span>
          <Icon name="chevronDown" size={18} />
        </button>
        {chip(t("list.filterCategory"), open("category"), category, { categoryId: undefined })}
        {live.length > 0 || filter.accountId
          ? chip(
              t("list.filterAccount"),
              open("account"),
              filter.accountId ? (accountNames[filter.accountId] ?? null) : null,
              { accountId: undefined },
            )
          : null}
        {chip(t("list.filterType"), open("type"), filter.type ? t(`type.${filter.type}`) : null, {
          type: undefined,
        })}
      </div>
      {payers.length > 1 ? (
        <nav aria-label={t("list.paidBy")} className="flex flex-wrap gap-2">
          {[["", t("list.anyone")] as const, ...payers].map(([id, name]) => {
            const current = (filter.payerMemberId ?? "") === id;
            return (
              <Link
                key={id || "anyone"}
                href={hrefOf(spaceId, { ...filter, payerMemberId: id || undefined })}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium [overflow-wrap:anywhere] ${
                  current ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
                }`}
              >
                {name}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {opened ? (
        <ListSheets
          sheet={sheet}
          onSheet={setSheet}
          periods={choices.map((p) => ({
            label: p.label,
            name: nameOf(p),
            href: hrefOf(spaceId, { ...filter, period: p.label }),
            current: p.label === period.label,
          }))}
          groups={groups}
          accounts={live.map((a) => [a.id, a.name] as const)}
          kinds={kinds.map((kind) => [kind, t(`type.${kind}`)] as const)}
          onNarrow={narrow}
        />
      ) : null}
    </div>
  );
}

/** Ruling P277: asks once the person pauses typing, or at once on Enter; blank asks for everything again. */
function SearchField({
  label,
  value,
  onSearch,
}: {
  readonly label: string;
  readonly value: string;
  readonly onSearch: (search: string) => void;
}) {
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
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink outline-none placeholder:text-muted"
      />
    </form>
  );
}
