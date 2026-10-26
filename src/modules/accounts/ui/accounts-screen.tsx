import Link from "next/link";
import { useTranslations } from "next-intl";
import { controlsFor } from "@/modules/spaces/ui";
import { Icon, ScreenHeader } from "@/shared/ui";
import type { AccountListDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { safeReturnTo, withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { ArchiveAccountButton, RestoreAccountButton, StarterAccountsButton } from "./account-actions";
import { AccountRow } from "./account-row";
import { sectionsOf } from "./account-sections";

const ACTION =
  "flex min-h-11 flex-none items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent";

/**
 * HU-E9-03, the Accounts artboard: the API's totals, then the accounts by type, then the archived ones (P131).
 * U4: the add button says what it adds, and no accounts is an empty state with the action. U1: a shared space holds
 * only funds (each person pays from their personal accounts), and the screen says so; a direct space holds none.
 */
export function AccountsScreen({
  spaceId,
  kind = "PERSONAL",
  role = null,
  list,
  formats,
  returnTo,
}: {
  readonly spaceId: string;
  readonly kind?: SpaceDto["kind"];
  readonly role?: SpaceDto["role"];
  readonly list: AccountListDto;
  readonly formats: Formats;
  /** Where creating an account returns to: the screen this one was opened from (the home's card), else itself. */
  readonly returnTo?: string | null;
}) {
  const t = useTranslations("accounts");
  const { active, archived } = sectionsOf(list.items);
  const newHref = withReturnTo(
    `/spaces/${spaceId}/accounts/new`,
    safeReturnTo(returnTo) ?? `/spaces/${spaceId}/accounts`,
  );
  const shared = kind === "SHARED";
  // Only a shared space's OWNER or ADMIN creates or edits funds; a direct space has no accounts; a personal one always may.
  const canManage = kind === "PERSONAL" || (shared && controlsFor(role, kind).manageFunds);
  const nothing = list.items.length === 0;
  // Issue 169: with no active account the totals say nothing, so the empty state stands in for them; a personal
  // space also offers its starter accounts (archived ones stay listed below and keep their names).
  const noActive = active.length === 0;
  const personal = kind === "PERSONAL";
  return (
    <div className="flex flex-col gap-6 py-4">
      <ScreenHeader
        backHref={`/spaces/${spaceId}`}
        title={t("title")}
        action={
          canManage && !noActive ? (
            <Link href={newHref} className={ACTION}>
              <Icon name="plus" size={20} />
              {shared ? t("newFund") : t("new")}
            </Link>
          ) : undefined
        }
      />
      {shared || kind === "DIRECT" ? (
        <p className="text-sm text-muted">{kind === "DIRECT" ? t("directNote") : t("fundsNote")}</p>
      ) : null}
      {noActive ? (
        <section
          aria-labelledby="accounts-empty"
          className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-5"
        >
          <h2 id="accounts-empty" className="text-lg font-semibold text-ink">
            {shared
              ? t("empty.fundsTitle")
              : kind === "DIRECT"
                ? t("empty.directTitle")
                : nothing
                  ? t("empty.title")
                  : t("empty.noActiveTitle")}
          </h2>
          {personal ? <p className="text-sm text-muted">{t("empty.body")}</p> : null}
          {personal ? (
            <>
              <p className="text-sm text-muted">{t("empty.starterBody")}</p>
              <StarterAccountsButton spaceId={spaceId} />
            </>
          ) : null}
          {canManage ? (
            <Link href={newHref} className={ACTION}>
              <Icon name="plus" size={20} />
              {shared ? t("createFund") : t("new")}
            </Link>
          ) : null}
        </section>
      ) : (
        <section aria-label={t("totals")} className="flex flex-wrap gap-3">
          <dl className="contents">
            <div className="flex-auto rounded-2xl bg-surface p-4">
              <dt className="text-sm text-muted">{t("available")}</dt>
              <dd className="text-xl font-semibold whitespace-nowrap text-ink">
                {formatMoney(list.totals.available, formats)}
              </dd>
            </div>
            <div className="flex-auto rounded-2xl bg-surface p-4">
              <dt className="text-sm text-muted">{t("netWorth")}</dt>
              <dd className="text-xl font-semibold whitespace-nowrap text-ink">
                {formatMoney(list.totals.netWorth, formats)}
              </dd>
            </div>
          </dl>
        </section>
      )}
      {active.map((section) => (
        <section key={section.key} aria-labelledby={`accounts-${section.key}`}>
          <h2 id={`accounts-${section.key}`} className="mb-1 text-sm font-semibold text-muted">
            {t(`section.${section.key}`)}
          </h2>
          <ul className="divide-y divide-line rounded-2xl bg-surface px-4">
            {section.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                formats={formats}
                editHref={canManage ? `/spaces/${spaceId}/accounts/${account.id}/edit` : undefined}
                actions={<ArchiveAccountButton spaceId={spaceId} account={account} />}
              />
            ))}
          </ul>
        </section>
      ))}
      {archived.length > 0 ? (
        <section aria-labelledby="accounts-archived">
          <h2 id="accounts-archived" className="mb-1 text-sm font-semibold text-muted">
            {t("archived")}
          </h2>
          <ul className="divide-y divide-line rounded-2xl bg-surface px-4">
            {archived.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                formats={formats}
                actions={<RestoreAccountButton spaceId={spaceId} account={account} />}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
