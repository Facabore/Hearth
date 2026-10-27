import Link from "next/link";
import { useTranslations } from "next-intl";
import { controlsFor, JoinedNotice } from "@/modules/spaces/ui";
import { Icon, SymbolIcon } from "@/shared/ui";
import type { AccountDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney } from "@/shared/ui/format/formatters";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { periodName } from "@/shared/ui/time/period-name";
import type { TransactionDetail } from "../detail/detail-loader";
import { TransactionSheetHost } from "../detail/transaction-sheet-host";
import { withTx } from "../detail/tx-href";
import { TransactionRow, type RowContext } from "../transaction-row";

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
}: {
  readonly spaceId: string;
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
  return (
    <div className="grid grid-cols-1 gap-3 py-3 lg:grid-cols-2">
      <h1 className="sr-only">{t("title")}</h1>
      {joined ? (
        <div className="lg:col-span-2">
          <JoinedNotice space={joined.space} dismissHref={joined.dismissHref} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
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
                {formatMoney(page.totals.expenses, formats)}
              </p>
              <p className="text-sm text-muted">
                {t("income", { amount: formatMoney(page.totals.income, formats) })}
              </p>
            </section>
            {personal ? null : (
              <p className="text-sm text-muted">
                {kind === "DIRECT" ? accountsNote("directNote") : accountsNote("fundsNote")}
              </p>
            )}
            {accounts.length === 0 ? (
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
                  <Link href={`/spaces/${spaceId}/accounts`} aria-label={t("allAccounts")} className={link}>
                    {t("allAccountsShort")}
                  </Link>
                </div>
                <ul className="flex gap-3 overflow-x-auto pb-1">
                  {accounts.map((account) => (
                    <li
                      key={account.id}
                      className="flex w-[156px] shrink-0 flex-col rounded-2xl bg-surface p-3"
                    >
                      <span className="text-sm [overflow-wrap:anywhere] text-muted">{account.name}</span>
                      <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                        {formatMoney(account.balance, formats)}
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
            {t("recent")}
          </h2>
          <Link href={`/spaces/${spaceId}/transactions`} aria-label={t("allTransactions")} className={link}>
            {t("allTransactionsShort")}
          </Link>
        </div>
        {page.items.length === 0 ? (
          <p className="rounded-2xl bg-surface p-3 text-sm text-muted">{t("recentEmpty")}</p>
        ) : (
          <ol className="divide-y divide-line rounded-2xl bg-surface px-3">
            {page.items.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                context={context}
                href={withTx(`/spaces/${spaceId}`, tx.id)}
              />
            ))}
          </ol>
        )}
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
