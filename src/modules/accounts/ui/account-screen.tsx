import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon, ScreenHeader, usePeriodText, VisuallyHidden } from "@/shared/ui";
import type { AccountDto, MoneyDto, PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, formatSignedMoney, type Formats } from "@/shared/ui/format/formatters";

/** Ruling P327: the account screen's two views, Movimientos and Estadísticas. */
export type AccountScreenView = "movements" | "stats";

/** Ruling P327: what the account moved in the period, from its breakdown (computed on read, D7). */
export interface AccountFigures {
  readonly in: MoneyDto;
  readonly out: MoneyDto;
  /** What it paid for expenses: the breakdown's total. */
  readonly spent: MoneyDto;
  readonly movedToOwnAccounts: MoneyDto;
}

const STEP = "flex size-11 shrink-0 items-center justify-center rounded-full text-ink";

/** Ruling P327 (boards #315): the chosen view is tinted with the accent, the other outlined. */
const chip = (selected: boolean) =>
  `flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm ${
    selected ? "bg-accent-soft font-semibold text-accent" : "border border-line bg-surface text-ink"
  }`;

const negated = (money: MoneyDto): MoneyDto =>
  BigInt(money.amount) === 0n ? money : { ...money, amount: (-BigInt(money.amount)).toString() };

/**
 * Ruling P327 (boards "Cuenta · Movimientos", "Cuenta · Estadísticas" and "Fondo de Hogar · Movimientos" · #315): an
 * account's own screen. Its name in the header with Configurar for whoever may manage it, its balance today as the
 * hero, the chips Movimientos | Estadísticas, the period with its arrows, one line of the period's figures, then the
 * chosen view.
 */
export function AccountScreen({
  spaceId,
  account,
  editHref,
  view,
  movementsHref,
  statsHref,
  period,
  policy,
  previousHref,
  nextHref,
  figures,
  formats,
  children,
}: {
  readonly spaceId: string;
  readonly account: AccountDto;
  /** Today's edit form, only for whoever may manage the account (P327). */
  readonly editHref?: string | undefined;
  readonly view: AccountScreenView;
  readonly movementsHref: string;
  readonly statsHref: string;
  readonly period: PeriodDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly previousHref?: string | undefined;
  /** None on the current period: there is no step past it. */
  readonly nextHref?: string | undefined;
  /** Null when the period's figures could not be read; the movements still show. */
  readonly figures: AccountFigures | null;
  readonly formats: Formats;
  readonly children: ReactNode;
}) {
  const t = useTranslations("accounts.screen");
  const tc = useTranslations("common");
  const label = usePeriodText()(period, policy, formats);
  const figure = (chunks: ReactNode) => <span className="whitespace-nowrap">{chunks}</span>;
  const moved = figures !== null && BigInt(figures.movedToOwnAccounts.amount) !== 0n;
  return (
    <div className="flex flex-col gap-3 py-3">
      <ScreenHeader
        backHref={`/spaces/${spaceId}/accounts`}
        title={account.name}
        action={
          editHref ? (
            <Link
              href={editHref}
              className="-mr-2 flex min-h-11 shrink-0 items-center px-2 text-[15px] font-semibold text-accent"
            >
              {t("configure")}
            </Link>
          ) : undefined
        }
      />
      <section aria-labelledby="account-balance" className="flex flex-col">
        <h2 id="account-balance" className="text-[15px] text-muted">
          {t("balanceToday")}
        </h2>
        <p className="text-[28px] leading-tight font-bold whitespace-nowrap text-ink min-[375px]:text-[34px]">
          {formatMoney(account.balance, formats)}
        </p>
      </section>
      <nav aria-label={t("views")} className="flex flex-wrap gap-2">
        <Link
          href={movementsHref}
          replace
          aria-current={view === "movements" ? "page" : undefined}
          className={chip(view === "movements")}
        >
          {t("movements")}
        </Link>
        <Link
          href={statsHref}
          replace
          aria-current={view === "stats" ? "page" : undefined}
          className={chip(view === "stats")}
        >
          {t("statistics")}
        </Link>
      </nav>
      <div className="flex items-center justify-between gap-2">
        {previousHref ? (
          <Link href={previousHref} replace className={STEP}>
            <Icon name="back" />
            <VisuallyHidden>{tc("previousPeriod")}</VisuallyHidden>
          </Link>
        ) : (
          <span className="size-11 shrink-0" />
        )}
        <p className="text-center text-[17px] font-semibold text-ink first-letter:uppercase">{label}</p>
        {nextHref ? (
          <Link href={nextHref} replace className={STEP}>
            <Icon name="chevronRight" />
            <VisuallyHidden>{tc("nextPeriod")}</VisuallyHidden>
          </Link>
        ) : (
          // Board #315: the step past the current period shows, faint, and goes nowhere.
          <span aria-hidden="true" className={`${STEP} text-muted opacity-35`}>
            <Icon name="chevronRight" />
          </span>
        )}
      </div>
      {figures ? (
        <p data-account-figures className="text-sm text-muted">
          {view === "movements"
            ? t.rich("flows", {
                in: formatSignedMoney(figures.in, formats),
                out: formatMoney(negated(figures.out), formats),
                b: figure,
              })
            : t.rich(moved ? "spentAndMoved" : "spent", {
                spent: formatMoney(figures.spent, formats),
                moved: formatMoney(figures.movedToOwnAccounts, formats),
                b: figure,
              })}
        </p>
      ) : null}
      {children}
    </div>
  );
}
