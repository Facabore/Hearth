"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, SymbolIcon } from "@/shared/ui";
import { formatCount } from "@/shared/ui/format/count";
import type { NumberFormat } from "@/shared/ui/format/formatters";

/**
 * D27, board "1 · Más: invitar": the personal Más row that opens Invitar a Hearth, with the points so far once they
 * are known. The row keeps its height while they load, so nothing moves when they arrive.
 */
export function InviteRow({
  href,
  points,
  formats,
}: {
  readonly href: string;
  /** Undefined while the points load or when they could not be read: the row still opens the screen. */
  readonly points: number | undefined;
  readonly formats: { readonly numberFormat: NumberFormat };
}) {
  const t = useTranslations("shell.more");
  return (
    <Link
      href={href}
      className="flex min-h-row-lg w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2 text-ink"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <SymbolIcon name="users" size={20} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
        <span className="text-[15px] font-medium">{t("invite")}</span>
        {points === undefined ? null : (
          <span className="text-[13px] text-muted">
            {t("invitePoints", { n: points, count: formatCount(points, formats) })}
          </span>
        )}
      </span>
      <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
    </Link>
  );
}
