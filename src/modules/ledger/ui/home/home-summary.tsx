import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { controlsFor, JoinedNotice } from "@/modules/spaces/ui";
import { Icon } from "@/shared/ui";
import type { AccountDto, MoneyDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney } from "@/shared/ui/format/formatters";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { periodName } from "@/shared/ui/time/period-name";
import type { TransactionDetail } from "../detail/transaction-detail";
import { TransactionSheetHost } from "../detail/transaction-sheet-host";
import { hrefOf, withTx } from "../detail/tx-href";
import { TransactionRow, type RowContext } from "../transaction-row";
import { FirstSteps, startedFirstSteps, type FirstStepsDone } from "./first-steps";
import { Hero } from "./unified-summary";

/** A section's title on the page, with its link on the right (ruling P324: flat, no card). */
const TITLE = "text-[15px] font-medium text-ink";
const LINK = "flex min-h-11 items-center text-sm font-medium text-accent";

/**
 * HU-E9-01, as ruling P324 draws it at medium density (boards "Inicio personal" and "Inicio de Hogar"): one hero, the
 * period's spending, with one line under it; one action line, what needs the person today; Recientes; and, at the end,
 * the accounts that hold money and the personal plan and first steps, each one link. Nothing sits in a card. From
 * 1024 px Recientes sits on the right.
 */
export function HomeSummary({
  spaceId,
  kind = "PERSONAL",
  name,
  role = null,
  joined,
  policy,
  page,
  accounts,
  context,
  detail,
  summary,
  plan,
  recent,
  today,
  firstSteps,
  needs,
  stepper,
  past = false,
}: {
  readonly spaceId: string;
  /** Issue #216: the viewer's today, so each recent row says which day it is from. */
  readonly today: string;
  /** N10: a shared or direct space leads to its members; whoever may invite also gets Invitar. */
  readonly kind?: SpaceDto["kind"];
  /** Ruling P324: a shared or direct space's hero says that the space spent it ("Hogar gastó en noviembre"). */
  readonly name?: string | undefined;
  readonly role?: SpaceDto["role"];
  /** U6: set right after accepting an invitation (`?joined=1`): the one-time welcome and where dismissing it goes. */
  readonly joined?: { readonly space: string; readonly dismissHref: string } | undefined;
  readonly policy: SpaceDto["periodPolicy"];
  readonly page: TransactionPageDto;
  readonly accounts: readonly AccountDto[];
  readonly context: RowContext;
  /** Ruling P189: the transaction behind `?tx=`, shown in a sheet over the home. */
  readonly detail?: TransactionDetail | undefined;
  /**
   * Ruling P306 (amends U4): what stands in for the period's hero, on the personal home of someone with other spaces
   * her month across all of them (`UnifiedSummary`). The route fills it, so the screens that redraw Inicio, such as the
   * record sheet's backdrop (P300), never load it.
   */
  readonly summary?: ReactNode;
  /**
   * Rulings P311 and P324: the period's plan as one link to its Plan screen (`PlanCard`): the last line of the personal
   * Inicio, and the line under a shared space's hero. The route fills it, so the record sheet's backdrop never loads it.
   */
  readonly plan?: ReactNode;
  /** Ruling P306: what stands in for Recientes' rows, her own and her spaces' merged (`UnifiedRecent`). */
  readonly recent?: ReactNode;
  /** Issues #220 (F14) and #152: on the personal home, a new person's four first steps. */
  readonly firstSteps?: { readonly personId: string; readonly done: FirstStepsDone } | undefined;
  /**
   * #288: what needs the person today, the action line under the hero (bills to confirm, what she is owed, her turn to
   * put money in). The route fills it from a chunk of its own, so the record sheet's backdrop never loads it.
   */
  readonly needs?: ReactNode;
  /** Ruling P310: the personal Inicio's step between periods, above the period's figure. */
  readonly stepper?: ReactNode;
  /**
   * Ruling P310: a period that ended before today. It shows that period's figure and movements, never today's balances:
   * no "Te toca poner", first steps or accounts.
   */
  readonly past?: boolean;
}) {
  const t = useTranslations("home");
  const common = useTranslations("common");
  const accountsNote = useTranslations("accounts");
  const { formats } = context;
  const period = periodName(page.period, policy);
  const controls = controlsFor(role, kind);
  const personal = kind === "PERSONAL";
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const firstAccount = personal && accounts.length === 0;
  // Ruling P324: an account that holds nothing takes no room on Inicio; Cuentas still lists it.
  const holding = accounts.filter((account) => BigInt(account.balance.amount) !== 0n);
  const steps =
    firstSteps && !past && !firstAccount ? (
      <FirstSteps spaceId={spaceId} personId={firstSteps.personId} done={firstSteps.done} />
    ) : null;
  const stepsStarted = firstSteps !== undefined && startedFirstSteps(firstSteps.done);
  const income = <p className="text-sm text-muted">{t("income", { amount: money(page.totals.income) })}</p>;
  return (
    <div className="grid grid-cols-1 items-start gap-3 py-3 lg:grid-cols-2 lg:gap-x-6">
      <h1 className="sr-only">{t("title")}</h1>
      {joined ? (
        <div className="lg:col-span-2">
          <JoinedNotice space={joined.space} dismissHref={joined.dismissHref} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        {stepper}
        {/* #290 (audit pass 3, A16): a viewer's bar has no Registrar; the home says why. */}
        {!personal && role === "VIEWER" ? <p className="text-sm text-muted">{t("viewerNote")}</p> : null}
        {firstAccount ? (
          <section aria-labelledby="home-first-account" className="flex flex-col items-start gap-3">
            <h2 id="home-first-account" className="text-lg font-semibold text-ink">
              {t("firstAccount.title")}
            </h2>
            <p className="text-sm text-muted">{t("firstAccount.body")}</p>
            <Link
              href={withReturnTo(`/spaces/${spaceId}/accounts`, `/spaces/${spaceId}`)}
              className="flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
            >
              {t("firstAccount.action")}
            </Link>
          </section>
        ) : (
          <>
            {summary ?? (
              <Hero
                period={page.period}
                policy={policy}
                formats={formats}
                space={personal ? undefined : name}
                amount={money(page.totals.expenses)}
              >
                {/* Ruling P324: a shared space's hero leads to its plan; without one, and at home, the income. */}
                {!personal && plan ? plan : income}
              </Hero>
            )}
            {/* #288: what needs the person today; a period that ended shows none of today's. */}
            {past ? null : needs}
            {/* Before any step is done, they are the new person's list right under the hero. */}
            {stepsStarted ? null : steps}
          </>
        )}
      </div>
      <section aria-labelledby="home-recent" className="flex min-w-0 flex-col lg:row-span-2">
        <div className="flex items-center justify-between">
          <h2 id="home-recent" className={TITLE}>
            {!past
              ? t("recent")
              : period.kind === "month"
                ? t("recentIn", { month: common(`month.${period.month as 1}`) })
                : t("recentBetween", {
                    start: formatDate(period.start, formats),
                    end: formatDate(period.end, formats),
                  })}
          </h2>
          <Link
            href={hrefOf(spaceId, past ? { period: page.period.label } : {})}
            aria-label={t("allTransactions")}
            className={LINK}
          >
            {t("allTransactionsShort")}
          </Link>
        </div>
        {recent ??
          (page.items.length === 0 ? (
            <p className="py-3 text-sm text-muted">{t("recentEmpty")}</p>
          ) : (
            // Board B1 · 03: plain rows on the page, with dividers; while the eye hides amounts, each row's is masked.
            <ol className="divide-y divide-line">
              {page.items.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  context={context}
                  href={withTx(`/spaces/${spaceId}`, tx.id)}
                  today={today}
                />
              ))}
            </ol>
          ))}
      </section>
      {firstAccount ? null : (
        <div className="flex min-w-0 flex-col gap-3 lg:col-start-1">
          {/* Ruling P324: Inicio carries no Miembros or Invitar pills and no note on funds; Más and Cuentas hold them. */}
          {past ? null : accounts.length > 0 ? (
            <section aria-labelledby="home-accounts" className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between">
                <h2 id="home-accounts" className={TITLE}>
                  {personal ? t("accounts") : t("funds")}
                </h2>
                {/* Issue #178: a shared space's list is of funds, and its link says so. */}
                <Link
                  href={`/spaces/${spaceId}/accounts`}
                  aria-label={personal ? t("allAccounts") : t("allFunds")}
                  className={LINK}
                >
                  {personal ? t("allAccountsShort") : t("allFundsShort")}
                </Link>
              </div>
              {/* Only the accounts that hold money are listed; the link still leads to every one of them. */}
              <ul aria-labelledby="home-accounts" className="flex flex-col divide-y divide-line">
                {holding.map((account) => (
                  <li key={account.id} className="flex min-h-row items-center justify-between gap-3">
                    <span className="min-w-0 [overflow-wrap:anywhere] text-ink">{account.name}</span>
                    <span className="shrink-0 font-semibold whitespace-nowrap text-ink">
                      {money(account.balance)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : accounts.length === 0 && kind === "SHARED" && controls.manageFunds ? (
            <Link
              href={withReturnTo(`/spaces/${spaceId}/accounts/new`, `/spaces/${spaceId}`)}
              className="flex min-h-11 items-center gap-2 self-start text-sm font-semibold text-accent"
            >
              <Icon name="plus" size={18} />
              {accountsNote("createFund")}
            </Link>
          ) : null}
          {personal ? plan : null}
          {stepsStarted ? steps : null}
        </div>
      )}
      {detail ? (
        <TransactionSheetHost
          spaceId={spaceId}
          detail={detail}
          context={context}
          origin={`/spaces/${spaceId}`}
        />
      ) : null}
    </div>
  );
}
