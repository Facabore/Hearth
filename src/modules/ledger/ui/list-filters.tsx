"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CategoryPicker, categoryPath } from "@/modules/categories/ui";
import { Button, Icon, usePeriodText, VisuallyHidden } from "@/shared/ui";
import type { CategoryGroupDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { hrefOf, type ListFilter } from "./list-href";

/**
 * HU-E9-03: the period with its neighbours, and the category filter (the API rolls subcategories up, P130). N8: a
 * period is a place, so its arrows push; the category filter only narrows the place, so it replaces the entry.
 */
export function ListFilters({
  spaceId,
  period,
  previous,
  next,
  filter,
  groups,
  periodPolicy,
  formats,
  memberNames = {},
  movedMemberIds,
}: {
  readonly spaceId: string;
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly filter: ListFilter;
  readonly groups: CategoryGroupDto[];
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
  const t = useTranslations("ledger.list");
  const periodText = usePeriodText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const chosen = filter.categoryId ? categoryPath(groups, filter.categoryId) : null;
  const step = "flex size-11 items-center justify-center rounded-xl text-ink";
  const payers = Object.entries(memberNames).filter(
    ([id]) => movedMemberIds === undefined || movedMemberIds.includes(id) || id === filter.payerMemberId,
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        {previous ? (
          <Link href={hrefOf(spaceId, { ...filter, period: previous.label })} className={step}>
            <Icon name="back" />
            <VisuallyHidden>{t("previous")}</VisuallyHidden>
          </Link>
        ) : (
          <span className="size-11" />
        )}
        <p className="font-medium text-ink">
          {periodPolicy ? periodText(period, periodPolicy, formats) : t("period", { label: period.label })}
        </p>
        {next ? (
          <Link href={hrefOf(spaceId, { ...filter, period: next.label })} className={step}>
            <Icon name="chevronRight" />
            <VisuallyHidden>{t("next")}</VisuallyHidden>
          </Link>
        ) : (
          <span className="size-11" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {chosen ? (
          <Button
            variant="secondary"
            aria-pressed="true"
            aria-label={t("removeFilter", { name: chosen })}
            size="chip"
            onClick={() =>
              router.replace(hrefOf(spaceId, { period: filter.period, payerMemberId: filter.payerMemberId }))
            }
          >
            {chosen} ✕
          </Button>
        ) : (
          <Button variant="secondary" size="chip" onClick={() => setOpen(true)}>
            <Icon name="search" size={18} />
            {t("filterCategory")}
          </Button>
        )}
      </div>
      {payers.length > 1 ? (
        <nav aria-label={t("paidBy")} className="flex flex-wrap gap-2">
          {[["", t("anyone")] as const, ...payers].map(([id, name]) => {
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
      <CategoryPicker
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        value={null}
        title={t("filterTitle")}
        onChoose={(choice) => {
          if (choice)
            router.replace(
              hrefOf(spaceId, { ...filter, categoryId: choice.subcategoryId ?? choice.categoryId }),
            );
        }}
      />
    </div>
  );
}
