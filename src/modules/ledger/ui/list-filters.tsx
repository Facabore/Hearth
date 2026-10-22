"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CategoryPicker, categoryPath } from "@/modules/categories/ui";
import { Button, Icon, VisuallyHidden } from "@/shared/ui";
import type { CategoryGroupDto, PeriodDto } from "@/shared/ui/api/dto";
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
}: {
  readonly spaceId: string;
  readonly period: PeriodDto;
  readonly previous: PeriodDto | null;
  readonly next: PeriodDto | null;
  readonly filter: ListFilter;
  readonly groups: CategoryGroupDto[];
}) {
  const t = useTranslations("ledger.list");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const chosen = filter.categoryId ? categoryPath(groups, filter.categoryId) : null;
  const step = "flex size-11 items-center justify-center rounded-xl text-ink";
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
        <p className="font-medium text-ink">{t("period", { label: period.label })}</p>
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
            className="h-11 rounded-full px-4 text-sm"
            onClick={() => router.replace(hrefOf(spaceId, { period: filter.period }))}
          >
            {chosen} ✕
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="h-11 rounded-full px-4 text-sm"
            onClick={() => setOpen(true)}
          >
            <Icon name="search" size={18} />
            {t("filterCategory")}
          </Button>
        )}
      </div>
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
