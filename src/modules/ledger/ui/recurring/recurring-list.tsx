"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CategoryIcon, findCategory } from "@/modules/categories/ui";
import { controlsFor } from "@/modules/spaces/ui";
import { Badge, Icon, paletteVars, ScreenHeader, SymbolIcon } from "@/shared/ui";
import type { CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import type { RecurrenceDto } from "./recurrence-request";
import { partyOf, scheduleText, signedAmountOf, type RecurrenceNames } from "./recurrence-text";

const ACTION =
  "flex min-h-11 flex-none items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent";

export interface RecurringListProps extends RecurrenceNames {
  readonly space: SpaceDto;
  readonly recurrences: readonly RecurrenceDto[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
}

/** A recurrence's category icon, or the type's symbol for one without a category (a transfer, a contribution). */
export function RecurrenceIcon({
  recurrence,
  groups,
}: {
  readonly recurrence: RecurrenceDto;
  readonly groups: readonly CategoryGroupDto[];
}) {
  const found = recurrence.categoryId ? findCategory([...groups], recurrence.categoryId) : null;
  return found ? (
    <CategoryIcon icon={found.category.icon} color={found.category.color} size={40} />
  ) : (
    <span
      aria-hidden="true"
      style={paletteVars("GRAPHITE")}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint)] text-[var(--ink)]"
    >
      <SymbolIcon name={recurrence.type === "EXPENSE" ? "dots" : "wallet"} size={22} />
    </span>
  );
}

/** The status and mode badges: "Activa" carries its check, so it is never told by color alone. */
export function RecurrenceBadges({ recurrence }: { readonly recurrence: RecurrenceDto }) {
  const t = useTranslations("recurrences");
  return (
    <span className="flex flex-wrap gap-1.5">
      {recurrence.status === "ACTIVE" ? (
        <Badge tone="accent" icon="check">
          {t("status.ACTIVE")}
        </Badge>
      ) : (
        <Badge>{t(`status.${recurrence.status}`)}</Badge>
      )}
      {recurrence.status === "ENDED" ? null : <Badge>{t(`mode.${recurrence.mode}`)}</Badge>}
    </span>
  );
}

function RecurrenceRow({
  recurrence,
  space,
  groups,
  names,
  formats,
}: {
  readonly recurrence: RecurrenceDto;
  readonly space: SpaceDto;
  readonly groups: readonly CategoryGroupDto[];
  readonly names: RecurrenceNames;
  readonly formats: Formats;
}) {
  const t = useTranslations("recurrences");
  const ledger = useTranslations("ledger");
  const party = partyOf(recurrence, names, {
    shared: space.kind !== "PERSONAL",
    transfer: (from, to) => ledger("transfer", { from, to }),
  });
  const meta = [t(`type.${recurrence.type}`), scheduleText(recurrence.schedule, t), party].filter(Boolean);
  const when =
    recurrence.status === "PAUSED"
      ? t("list.paused")
      : recurrence.status === "ENDED"
        ? recurrence.endDate
          ? t("list.endedOn", { date: formatDate(recurrence.endDate, formats) })
          : null
        : recurrence.nextOccurrence
          ? t("next", { date: formatDate(recurrence.nextOccurrence, formats) })
          : null;
  const ended = recurrence.status === "ENDED";
  return (
    <li>
      {/* The link wraps the row's whole text, so its name holds what it shows (WCAG 2.5.3). */}
      <Link
        href={`/spaces/${space.id}/recurrences/${recurrence.id}`}
        className="flex items-start gap-3 px-3 py-3"
      >
        <RecurrenceIcon recurrence={recurrence} groups={groups} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span
              className={
                ended
                  ? "min-w-0 font-semibold break-words text-muted"
                  : "min-w-0 font-semibold break-words text-ink"
              }
            >
              {recurrence.description}
            </span>
            <span
              className={
                ended
                  ? "shrink-0 font-semibold whitespace-nowrap text-muted"
                  : "shrink-0 font-semibold whitespace-nowrap text-ink"
              }
            >
              {signedAmountOf(recurrence, formats)}
            </span>
          </span>
          <span className="text-sm break-words text-muted">{meta.join(" · ")}</span>
          {when ? <span className="text-sm text-ink">{when}</span> : null}
          <span className="mt-1">
            <RecurrenceBadges recurrence={recurrence} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The role note a VIEWER reads instead of the controls (S6). */
function ViewerNote({ space }: { readonly space: Pick<SpaceDto, "name" | "role"> }) {
  const t = useTranslations("recurrences");
  const roles = useTranslations("shell.role");
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-track p-3 text-sm text-ink">
      <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
      {t("viewer.list", { space: space.name, role: space.role ? roles(space.role) : "" })}
    </p>
  );
}

/** The form's place for someone who cannot define a recurrence here: her role, before she types anything. */
export function RecurringNotAllowed({ space }: { readonly space: Pick<SpaceDto, "id" | "name" | "role"> }) {
  const t = useTranslations("recurrences");
  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-3 py-3">
      <ScreenHeader
        backHref={`/spaces/${space.id}/recurrences`}
        title={t("form.title")}
        subtitle={space.name}
      />
      <ViewerNote space={space} />
    </div>
  );
}

/**
 * HU-E9-09, P270's "Recurrentes": the space's active recurrences ("Activos · {n}"), then the paused and ended ones. A
 * member who records money defines one with Nuevo; a VIEWER reads her role instead (S6).
 */
export function RecurringList({
  space,
  recurrences,
  groups,
  accountNames,
  memberNames,
  formats,
}: RecurringListProps) {
  const t = useTranslations("recurrences");
  const canManage = controlsFor(space.role, space.kind).recordMoney;
  const newHref = `/spaces/${space.id}/recurrences/new`;
  const active = recurrences.filter((r) => r.status === "ACTIVE");
  const inactive = recurrences.filter((r) => r.status !== "ACTIVE");
  const names = { accountNames, memberNames };
  const section = (id: string, title: string, items: readonly RecurrenceDto[]) =>
    items.length === 0 ? null : (
      <section aria-labelledby={id} className="flex flex-col gap-1">
        <h2 id={id} className="text-sm font-semibold text-muted">
          {title}
        </h2>
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((recurrence) => (
            <RecurrenceRow
              key={recurrence.id}
              recurrence={recurrence}
              space={space}
              groups={groups}
              names={names}
              formats={formats}
            />
          ))}
        </ol>
      </section>
    );
  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 py-3">
      <ScreenHeader
        backHref={`/spaces/${space.id}/transactions`}
        title={t("title")}
        subtitle={space.name}
        action={
          canManage ? (
            <Link href={newHref} className={ACTION}>
              <Icon name="plus" size={20} />
              {t("new")}
            </Link>
          ) : undefined
        }
      />
      {canManage ? null : <ViewerNote space={space} />}
      {recurrences.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-4">
          <p className="text-ink">{t("list.empty")}</p>
          {canManage ? (
            <Link href={newHref} className={ACTION}>
              <Icon name="plus" size={20} />
              {t("list.add")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {section("recurring-active", t("list.active", { count: active.length }), active)}
      {section("recurring-inactive", t("list.inactive"), inactive)}
    </div>
  );
}
