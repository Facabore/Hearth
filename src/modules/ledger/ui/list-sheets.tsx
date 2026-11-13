"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { activeTree, CategoryPicker } from "@/modules/categories/ui";
import { Icon, Sheet } from "@/shared/ui";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import type { ListFilter, ListSpace, TransactionKind } from "./list-href";

export type ListSheet = "filters" | "period" | "space" | "category" | "account" | "type";

/** One row of the Filtros sheet: the sheet it opens, and what it holds now (`null` while nothing narrows it). */
export type FilterRow = readonly [Exclude<ListSheet, "filters">, string | null];

/** One choice of the payer filter: Todos (`id` empty) or a member, with its list's address. */
export interface PayerChoice {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly current: boolean;
}

/** One period the period chip's sheet offers: its name, its list's address, and whether it is the one shown. */
export interface PeriodChoice {
  readonly label: string;
  readonly name: string;
  readonly href: string;
  readonly current: boolean;
}

/**
 * Ruling P277: the sheets of Movimientos' filters, in a chunk of their own that loads on the first tap, so the list's
 * script stays within its budget (ADR 0004). A period is a place, so choosing one follows a link (N8); a filter only
 * narrows the place. Ruling P324 (#309): every filter waits behind one Filtros button, whose sheet opens each one's.
 */
export function ListSheets({
  sheet,
  onSheet,
  rows,
  payers = [],
  recurringHref,
  periods,
  groups,
  accounts,
  kinds,
  onNarrow,
  spaces,
  spaceId,
  onSpace,
  categorySpaces,
}: {
  readonly sheet: ListSheet | null;
  readonly onSheet: (sheet: ListSheet | null) => void;
  /** Ruling P324: the Filtros sheet's rows, in the board's order. */
  readonly rows: readonly FilterRow[];
  /** Issue #148: Todos and the members to filter by who paid; none in a list without two payers. */
  readonly payers?: readonly PayerChoice[];
  /** P270: the space's recurring movements, reachable from Filtros. */
  readonly recurringHref: string;
  readonly periods: readonly PeriodChoice[];
  readonly groups: CategoryGroupDto[];
  readonly accounts: readonly (readonly [string, string])[];
  readonly kinds: readonly (readonly [TransactionKind, string])[];
  readonly onNarrow: (change: Partial<ListFilter>) => void;
  /** Ruling P319: the person's spaces for "Ver movimientos de", personal first, and the one chosen, if any. */
  readonly spaces?: readonly ListSpace[];
  readonly spaceId?: string | undefined;
  /** Ruling P319: lists one space, or every one (`undefined`). */
  readonly onSpace?: (spaceId: string | undefined) => void;
  /** Ruling P319: the spaces shown when there are several; Categoría then groups their categories by space (P308). */
  readonly categorySpaces?: readonly ListSpace[];
}) {
  const t = useTranslations("ledger.list");
  const opener = (name: ListSheet) => (open: boolean) => onSheet(open ? name : null);
  // P324: a row of Filtros swaps its sheet for the filter's in one render, so the filter's sheet mounts anew as it
  // opens and finds the panel Filtros loaded; mounted before that load, it would open a render after Filtros gave back
  // its history entry, and that Back would close it (P307).
  const fresh = (name: ListSheet) => `${name}-${sheet === name}`;
  return (
    <>
      <FiltersSheet
        open={sheet === "filters"}
        onOpenChange={opener("filters")}
        onSheet={onSheet}
        rows={rows}
        payers={payers}
        recurringHref={recurringHref}
      />
      <Sheet
        key={fresh("period")}
        open={sheet === "period"}
        onOpenChange={opener("period")}
        title={t("periods")}
      >
        <ul className="flex flex-col">
          {periods.map((p) => (
            <li key={p.label}>
              <Link
                href={p.href}
                aria-current={p.current ? "page" : undefined}
                onClick={() => onSheet(null)}
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 text-ink"
              >
                {/* A flex item: its first letter is styled in a box of its own, as the period chip does. */}
                <span className="inline-block first-letter:uppercase">{p.name}</span>
                {p.current ? <Icon name="check" className="text-accent" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
      {spaces && onSpace ? (
        <SpaceSheet
          key={fresh("space")}
          open={sheet === "space"}
          onOpenChange={opener("space")}
          spaces={spaces}
          spaceId={spaceId}
          onChoose={onSpace}
        />
      ) : null}
      {categorySpaces ? (
        <SpacesCategorySheet
          key={fresh("category")}
          open={sheet === "category"}
          onOpenChange={opener("category")}
          spaces={categorySpaces}
          onChoose={(categoryId) => onNarrow({ categoryId })}
        />
      ) : (
        <CategoryPicker
          key={fresh("category")}
          open={sheet === "category"}
          onOpenChange={opener("category")}
          groups={groups}
          value={null}
          title={t("filterTitle")}
          onChoose={(choice) => {
            if (choice) onNarrow({ categoryId: choice.subcategoryId ?? choice.categoryId });
          }}
        />
      )}
      <ChoiceSheet
        key={fresh("account")}
        open={sheet === "account"}
        onOpenChange={opener("account")}
        title={t("accountTitle")}
        options={accounts}
        onChoose={(accountId) => onNarrow({ accountId })}
      />
      <ChoiceSheet
        key={fresh("type")}
        open={sheet === "type"}
        onOpenChange={opener("type")}
        title={t("typeTitle")}
        options={kinds}
        onChoose={(type) => onNarrow({ type })}
      />
    </>
  );
}

const LABEL = {
  period: "periodLabel",
  space: "spaceLabel",
  category: "filterCategory",
  account: "filterAccount",
  type: "filterType",
} as const;

/**
 * Ruling P324 (board "Movimientos", densidad media): one row per filter, each opening its own sheet and naming what it
 * holds; then who paid, and the space's recurring movements (P270).
 */
function FiltersSheet({
  open,
  onOpenChange,
  onSheet,
  rows,
  payers,
  recurringHref,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSheet: (sheet: ListSheet | null) => void;
  readonly rows: readonly FilterRow[];
  readonly payers: readonly PayerChoice[];
  readonly recurringHref: string;
}) {
  const t = useTranslations("ledger.list");
  const recurring = useTranslations("recurrences");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("filters")}>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-line">
          {rows.map(([name, value]) => (
            <li key={name}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onSheet(name)}
                className="flex min-h-12 w-full items-center gap-3 px-1 text-left text-ink"
              >
                <span className="shrink-0 font-medium">{t(LABEL[name])}</span>{" "}
                <span className="min-w-0 flex-1 text-right text-muted [overflow-wrap:anywhere]">
                  {value ? <span className="inline-block first-letter:uppercase">{value}</span> : null}
                </span>
                <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
        {payers.length > 0 ? (
          <nav aria-label={t("paidBy")} className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted">{t("paidBy")}</p>
            <div className="flex flex-wrap gap-2">
              {payers.map((payer) => (
                <Link
                  key={payer.id || "anyone"}
                  href={payer.href}
                  aria-current={payer.current ? "page" : undefined}
                  onClick={() => onSheet(null)}
                  className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium [overflow-wrap:anywhere] ${
                    payer.current ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
                  }`}
                >
                  {payer.name}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}
        <Link
          href={recurringHref}
          onClick={() => onSheet(null)}
          className="flex min-h-11 items-center gap-2 self-start rounded-full border border-line bg-surface px-4 text-[15px] font-semibold text-ink"
        >
          <Icon name="calendar" size={18} />
          {recurring("pill")}
        </Link>
      </div>
    </Sheet>
  );
}

/** A filter's choices, one per row; a tap chooses and closes. */
function ChoiceSheet<T extends string>({
  open,
  onOpenChange,
  title,
  options,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly options: readonly (readonly [T, string])[];
  readonly onChoose: (value: T) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <ul className="flex flex-col">
        {options.map(([value, label]) => (
          <li key={value}>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onChoose(value);
              }}
              className="flex min-h-12 w-full items-center rounded-xl px-2 text-left [overflow-wrap:anywhere] text-ink"
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const ROW = "flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-ink";

/**
 * Ruling P319 (board "Movimientos de Personal: filtro de espacio abierto"): "Ver movimientos de" every space, the
 * personal one ("solo tú"), or one of the others by its chip. The one listed now carries the check.
 */
function SpaceSheet({
  open,
  onOpenChange,
  spaces,
  spaceId,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly ListSpace[];
  readonly spaceId: string | undefined;
  readonly onChoose: (spaceId: string | undefined) => void;
}) {
  const t = useTranslations("ledger.list");
  const row = (id: string | undefined, label: ReactNode) => (
    <li key={id ?? "all"}>
      <button
        type="button"
        aria-current={id === spaceId ? "true" : undefined}
        onClick={() => {
          onOpenChange(false);
          if (id !== spaceId) onChoose(id);
        }}
        className={ROW}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 [overflow-wrap:anywhere]">{label}</span>
        {id === spaceId ? <Icon name="check" className="shrink-0 text-accent" /> : null}
      </button>
    </li>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("spacesTitle")}>
      <ul className="flex flex-col">
        {row(undefined, t("allSpaces"))}
        {spaces.map((space) =>
          row(
            space.id,
            space.kind === "PERSONAL" ? (
              <>
                {space.name}
                <span className="text-sm text-muted">{t("onlyYou")}</span>
              </>
            ) : (
              <SpaceChip name={space.name} color={space.color} />
            ),
          ),
        )}
      </ul>
    </Sheet>
  );
}

/**
 * Ruling P319: Categoría while several spaces are shown, their live categories under "Categorías de {space}" (as the
 * record form's picker names its space, P308), by group. A category matches its subcategories too (P48).
 */
function SpacesCategorySheet({
  open,
  onOpenChange,
  spaces,
  onChoose,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaces: readonly ListSpace[];
  readonly onChoose: (categoryId: string) => void;
}) {
  const t = useTranslations("ledger.list");
  const picker = useTranslations("categories.picker");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("filterTitle")}>
      <div className="flex flex-col gap-4">
        {spaces.map((space) => {
          const groups = activeTree(space.groups).filter((g) => g.categories.length > 0);
          return groups.length === 0 ? null : (
            <section
              key={space.id}
              aria-labelledby={`categories-${space.id}`}
              className="flex flex-col gap-2"
            >
              <h3
                id={`categories-${space.id}`}
                className="text-sm font-semibold text-ink [overflow-wrap:anywhere]"
              >
                {picker("of", { space: space.name })}
              </h3>
              {groups.map((group) => (
                <div key={group.id} className="flex flex-col gap-1">
                  <p className="text-sm text-muted [overflow-wrap:anywhere]">{group.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          onChoose(category.id);
                        }}
                        className="min-h-11 rounded-full border border-line px-4 text-sm font-medium [overflow-wrap:anywhere] text-ink"
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </Sheet>
  );
}
