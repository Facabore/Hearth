"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CategoryPicker } from "@/modules/categories/ui";
import { Icon, Sheet } from "@/shared/ui";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import type { ListFilter, TransactionKind } from "./list-href";

export type ListSheet = "period" | "category" | "account" | "type";

/** One period the period chip's sheet offers: its name, its list's address, and whether it is the one shown. */
export interface PeriodChoice {
  readonly label: string;
  readonly name: string;
  readonly href: string;
  readonly current: boolean;
}

/**
 * Ruling P277: the sheets of Movimientos' chips, in a chunk of their own that loads on the first tap, so the list's
 * script stays within its budget (ADR 0004). A period is a place, so choosing one follows a link (N8); a filter only
 * narrows the place.
 */
export function ListSheets({
  sheet,
  onSheet,
  periods,
  groups,
  accounts,
  kinds,
  onNarrow,
}: {
  readonly sheet: ListSheet | null;
  readonly onSheet: (sheet: ListSheet | null) => void;
  readonly periods: readonly PeriodChoice[];
  readonly groups: CategoryGroupDto[];
  readonly accounts: readonly (readonly [string, string])[];
  readonly kinds: readonly (readonly [TransactionKind, string])[];
  readonly onNarrow: (change: Partial<ListFilter>) => void;
}) {
  const t = useTranslations("ledger.list");
  const opener = (name: ListSheet) => (open: boolean) => onSheet(open ? name : null);
  return (
    <>
      <Sheet open={sheet === "period"} onOpenChange={opener("period")} title={t("periods")}>
        <ul className="flex flex-col">
          {periods.map((p) => (
            <li key={p.label}>
              <Link
                href={p.href}
                aria-current={p.current ? "page" : undefined}
                onClick={() => onSheet(null)}
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 text-ink first-letter:uppercase"
              >
                {p.name}
                {p.current ? <Icon name="check" className="text-accent" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
      <CategoryPicker
        open={sheet === "category"}
        onOpenChange={opener("category")}
        groups={groups}
        value={null}
        title={t("filterTitle")}
        onChoose={(choice) => {
          if (choice) onNarrow({ categoryId: choice.subcategoryId ?? choice.categoryId });
        }}
      />
      <ChoiceSheet
        open={sheet === "account"}
        onOpenChange={opener("account")}
        title={t("accountTitle")}
        options={accounts}
        onChoose={(accountId) => onNarrow({ accountId })}
      />
      <ChoiceSheet
        open={sheet === "type"}
        onOpenChange={opener("type")}
        title={t("typeTitle")}
        options={kinds}
        onChoose={(type) => onNarrow({ type })}
      />
    </>
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
