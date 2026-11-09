"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Logo, VisuallyHidden } from "@/shared/ui";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";

/**
 * One landmark for both layouts: a bar fixed at the bottom under 1024 px, a 240 px rail from 1024 px (the Desktop
 * artboard). Ruling P311 (amends P200 and P302): Inicio, Movimientos, Registrar, Saldos, Más; Saldos in every space,
 * the personal one included, as the boards draw it (P272, ruling P302), so Registrar stays in the middle of the bar.
 * Plan left the bar: it opens from the space's Configuración. Más opens the space's modules and is current there.
 * Registrar only for someone who records in the space (#207): a viewer never meets a form she
 * cannot save. The Movimientos tab carries the space's pending occurrences as a badge (HU-E9-09, ruling P270); the shell
 * passes their count only to someone who records money, so a viewer never sees it, and nothing shows at zero.
 * Ruling P310 (amends P125 for this tab): Inicio always opens the person's personal Inicio, where everything she does
 * meets; a shared or direct space's own home is reached by choosing it in the space switcher.
 */
export function NavLinks({
  spaceId,
  homeSpaceId = spaceId,
  canRecord,
  pendingCount = 0,
}: {
  readonly spaceId: string;
  /** Ruling P310: the person's personal space, whose Inicio the Inicio tab opens from every space. */
  readonly homeSpaceId?: string;
  readonly canRecord: boolean;
  readonly pendingCount?: number;
}) {
  const t = useTranslations("shell.nav");
  const pending = useTranslations("recurrences.pending");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const home = `/spaces/${spaceId}`;
  // Issue #172: the record form returns to the screen it was opened from, unless that is the form itself.
  const record = withReturnTo(
    `${home}/new`,
    pathname === `${home}/new` ? null : `${pathname}${search ? `?${search}` : ""}`,
  );
  const transactions = `${home}/transactions`;
  const balances = `${home}/balances`;
  const more = `${home}/more`;
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);
  // Issue #196: a tab prefetches its skeleton under the space's own layout. Settings and New space draw this shell
  // themselves, so that prefetch would load the shell's script a second time (+14 KiB on their budgets): there a tab
  // loads when it is tapped, as before.
  const prefetch = pathname === home || pathname.startsWith(`${home}/`) ? {} : { prefetch: false };
  // `min-w-0`: the four tabs share the bar evenly, so Registrar stays in its middle (P302); a label wider than its tab
  // (Movimientos at 320 px) spills evenly around it instead of pushing Registrar aside.
  const item =
    "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted aria-[current=page]:text-accent lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-base";
  return (
    <nav
      aria-label={t("main")}
      className="fixed inset-x-0 bottom-0 z-10 flex h-[calc(76px+env(safe-area-inset-bottom))] items-center border-t border-line bg-surface px-4 pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:h-auto lg:w-[240px] lg:flex-col lg:items-stretch lg:gap-2 lg:border-t-0 lg:border-r lg:p-4"
    >
      <div className="hidden lg:mb-6 lg:block">
        <Logo />
      </div>
      <Link
        href={`/spaces/${homeSpaceId}`}
        {...prefetch}
        aria-current={current(`/spaces/${homeSpaceId}`)}
        className={item}
      >
        <Icon name="home" />
        {t("home")}
      </Link>
      <Link href={transactions} {...prefetch} aria-current={current(transactions)} className={item}>
        <span className="relative">
          <Icon name="list" />
          {pendingCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ink px-1 text-[11px] leading-none font-semibold text-surface"
            >
              {pendingCount}
            </span>
          ) : null}
        </span>
        {t("transactions")}
        {pendingCount > 0 ? (
          <VisuallyHidden>, {pending("badge", { count: pendingCount })}</VisuallyHidden>
        ) : null}
      </Link>
      {canRecord ? (
        <Link
          href={record}
          {...prefetch}
          aria-label={t("record")}
          aria-current={current(`${home}/new`)}
          className="order-none mx-2 flex size-14 items-center justify-center rounded-full bg-accent text-on-accent lg:-order-1 lg:mx-0 lg:h-12 lg:w-auto lg:gap-2 lg:rounded-[14px] lg:font-semibold"
        >
          <Icon name="plus" />
          <span className="hidden lg:inline">{t("recordShort")}</span>
        </Link>
      ) : null}
      <Link href={balances} {...prefetch} aria-current={current(balances)} className={item}>
        <Icon name="swap" />
        {t("balances")}
      </Link>
      <Link href={more} {...prefetch} aria-current={current(more)} className={item}>
        <Icon name="dots" />
        {t("more")}
      </Link>
    </nav>
  );
}
