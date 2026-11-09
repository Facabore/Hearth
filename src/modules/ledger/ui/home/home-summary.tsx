import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { controlsFor, JoinedNotice } from "@/modules/spaces/ui";
import { Icon, SymbolIcon } from "@/shared/ui";
import type { AccountDto, MoneyDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney } from "@/shared/ui/format/formatters";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { periodName } from "@/shared/ui/time/period-name";
import type { TransactionDetail } from "../detail/transaction-detail";
import { TransactionSheetHost } from "../detail/transaction-sheet-host";
import { hrefOf, withTx } from "../detail/tx-href";
import { TransactionRow, type RowContext } from "../transaction-row";
import { FirstSteps, type FirstStepsDone } from "./first-steps";

/**
 * HU-E9-01, the Home and Desktop artboards for M6a (the "no plan" variant, ruling P126): the period's spending and
 * income, the accounts, and the latest transactions. From 1024 px the recent list sits on the right.
 */
export function HomeSummary({
  spaceId,
  kind = "PERSONAL",
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
   * Ruling P306 (amends U4): what stands in for the period's summary, on the personal home of someone with other spaces
   * her month across all of them (`UnifiedSummary`). The route fills it, so the screens that redraw Inicio, such as the
   * record sheet's backdrop (P300), never load it.
   */
  readonly summary?: ReactNode;
  /**
   * Ruling P311: under the period's figure on the personal Inicio, the period's plan as one link to its Plan screen
   * (`PlanCard`). The route fills it, so the record sheet's backdrop never loads it.
   */
  readonly plan?: ReactNode;
  /** Ruling P306: what stands in for Recientes' rows, her own and her spaces' merged (`UnifiedRecent`). */
  readonly recent?: ReactNode;
  /** Issues #220 (F14) and #152: on the personal home, a new person's four first steps, under the period's figure. */
  readonly firstSteps?: { readonly personId: string; readonly done: FirstStepsDone } | undefined;
  /**
   * #288: what needs the person today ("Te necesita hoy": bills to confirm, what she is owed, her turn to put money in).
   * The route fills it from a chunk of its own, so the record sheet's backdrop never loads it.
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
  const { formats } = context;
  const name = periodName(page.period, policy);
  const link = "flex min-h-11 items-center text-sm font-medium text-accent";
  const pill =
    "flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink";
  const controls = controlsFor(role, kind);
  const canInvite = controls.invite;
  const accountsNote = useTranslations("accounts");
  const personal = kind === "PERSONAL";
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  return (
    <div className="grid grid-cols-1 gap-3 py-3 lg:grid-cols-2">
      <h1 className="sr-only">{t("title")}</h1>
      {joined ? (
        <div className="lg:col-span-2">
          <JoinedNotice space={joined.space} dismissHref={joined.dismissHref} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        {stepper}
        {kind !== "PERSONAL" ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/spaces/${spaceId}/members`} className={pill}>
              <SymbolIcon name="users" size={18} />
              {t("members")}
            </Link>
            {canInvite ? (
              <Link href={`/spaces/${spaceId}/members?invite=1`} className={pill}>
                <Icon name="userPlus" size={18} />
                {t("invite")}
              </Link>
            ) : null}
          </div>
        ) : null}
        {/* #290 (audit pass 3, A16): a viewer's bar has no Registrar; the home says why. */}
        {!personal && role === "VIEWER" ? <p className="text-sm text-muted">{t("viewerNote")}</p> : null}
        {personal && accounts.length === 0 ? (
          <section
            aria-labelledby="home-first-account"
            className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-3"
          >
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
              <section aria-label={t("summary")} className="rounded-2xl bg-surface p-3">
                <p className="text-sm text-muted">
                  {name.kind === "month"
                    ? t("spentIn", { month: common(`month.${name.month as 1}`) })
                    : t("spentBetween", {
                        start: formatDate(name.start, formats),
                        end: formatDate(name.end, formats),
                      })}
                </p>
                <p className="text-[clamp(1.75rem,8.5vw,2rem)] leading-tight font-semibold [overflow-wrap:anywhere] text-ink">
                  {money(page.totals.expenses)}
                </p>
                <p className="text-sm text-muted">{t("income", { amount: money(page.totals.income) })}</p>
              </section>
            )}
            {plan}
            {/* #288: what needs the person today; a period that ended shows none of today's. */}
            {past ? null : needs}
            {firstSteps && !past ? (
              <FirstSteps spaceId={spaceId} personId={firstSteps.personId} done={firstSteps.done} />
            ) : null}
            {personal ? null : (
              <p className="text-sm text-muted">
                {kind === "DIRECT" ? accountsNote("directNote") : accountsNote("fundsNote")}
              </p>
            )}
            {past ? null : accounts.length === 0 ? (
              kind === "SHARED" && controls.manageFunds ? (
                <Link
                  href={withReturnTo(`/spaces/${spaceId}/accounts/new`, `/spaces/${spaceId}`)}
                  className="flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-accent px-5 text-sm font-semibold text-on-accent"
                >
                  <Icon name="plus" size={18} />
                  {accountsNote("createFund")}
                </Link>
              ) : null
            ) : (
              <section aria-labelledby="home-accounts" className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 id="home-accounts" className="text-lg font-semibold text-ink">
                    {personal ? t("accounts") : t("funds")}
                  </h2>
                  {/* Issue #178: a shared space's list is of funds, and its link says so. */}
                  <Link
                    href={`/spaces/${spaceId}/accounts`}
                    aria-label={personal ? t("allAccounts") : t("allFunds")}
                    className={link}
                  >
                    {personal ? t("allAccountsShort") : t("allFundsShort")}
                  </Link>
                </div>
                {/*
                  It scrolls sideways once the accounts outgrow the screen: the keyboard can reach it to scroll. Issue
                  #223: a phone draws no scrollbar under it; the cut-off card says there is more.
                */}
                <ul
                  aria-labelledby="home-accounts"
                  tabIndex={0}
                  className="flex [scrollbar-width:none] gap-3 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
                >
                  {accounts.map((account) => (
                    <li
                      key={account.id}
                      className="flex w-[156px] shrink-0 flex-col rounded-2xl bg-surface p-3"
                    >
                      <span className="text-sm [overflow-wrap:anywhere] text-muted">{account.name}</span>
                      <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                        {money(account.balance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      <section aria-labelledby="home-recent" className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="home-recent" className="text-lg font-semibold text-ink">
            {!past
              ? t("recent")
              : name.kind === "month"
                ? t("recentIn", { month: common(`month.${name.month as 1}`) })
                : t("recentBetween", {
                    start: formatDate(name.start, formats),
                    end: formatDate(name.end, formats),
                  })}
          </h2>
          <Link
            href={hrefOf(spaceId, past ? { period: page.period.label } : {})}
            aria-label={t("allTransactions")}
            className={link}
          >
            {t("allTransactionsShort")}
          </Link>
        </div>
        {recent ??
          (page.items.length === 0 ? (
            <p className="rounded-2xl bg-surface p-3 text-sm text-muted">{t("recentEmpty")}</p>
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
