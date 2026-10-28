"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Logo } from "@/shared/ui";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import type { SpaceDto } from "@/shared/ui/api/dto";

/**
 * One landmark for both layouts: a bar fixed at the bottom under 1024 px, a 240 px rail from 1024 px (the Desktop
 * artboard). Ruling P160: the Batch 2 order, Inicio, Movimientos, Registrar, Plan, Saldos; Saldos only where balances
 * exist (shared and direct spaces). Plan (HU-E9-10, ruling P200, amending P141) is current on every path under
 * `/plan` and `/plans`.
 */
export function NavLinks({
  spaceId,
  spaceKind,
}: {
  readonly spaceId: string;
  readonly spaceKind: SpaceDto["kind"];
}) {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const home = `/spaces/${spaceId}`;
  // Issue #172: the record form returns to the screen it was opened from, unless that is the form itself.
  const record = withReturnTo(
    `${home}/new`,
    pathname === `${home}/new` ? null : `${pathname}${search ? `?${search}` : ""}`,
  );
  const transactions = `${home}/transactions`;
  const plan = `${home}/plan`;
  const balances = `${home}/balances`;
  const current = (href: string) => (pathname === href ? ("page" as const) : undefined);
  const underPlan = [plan, `${home}/plans`].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  // Issue #196: a tab prefetches its skeleton under the space's own layout. Settings and New space draw this shell
  // themselves, so that prefetch would load the shell's script a second time (+14 KiB on their budgets): there a tab
  // loads when it is tapped, as before.
  const prefetch = pathname === home || pathname.startsWith(`${home}/`) ? {} : { prefetch: false };
  const item =
    "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted aria-[current=page]:text-accent lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-base";
  return (
    <nav
      aria-label={t("main")}
      className="fixed inset-x-0 bottom-0 z-10 flex h-[calc(76px+env(safe-area-inset-bottom))] items-center border-t border-line bg-surface px-4 pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:h-auto lg:w-[240px] lg:flex-col lg:items-stretch lg:gap-2 lg:border-t-0 lg:border-r lg:p-4"
    >
      <div className="hidden lg:mb-6 lg:block">
        <Logo />
      </div>
      <Link href={home} {...prefetch} aria-current={current(home)} className={item}>
        <Icon name="home" />
        {t("home")}
      </Link>
      <Link href={transactions} {...prefetch} aria-current={current(transactions)} className={item}>
        <Icon name="list" />
        {t("transactions")}
      </Link>
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
      <Link href={plan} {...prefetch} aria-current={underPlan ? "page" : undefined} className={item}>
        <Icon name="chart" />
        {t("plan")}
      </Link>
      {spaceKind !== "PERSONAL" ? (
        <Link href={balances} {...prefetch} aria-current={current(balances)} className={item}>
          <Icon name="swap" />
          {t("balances")}
        </Link>
      ) : null}
    </nav>
  );
}
