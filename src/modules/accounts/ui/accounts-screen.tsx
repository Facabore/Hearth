import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, VisuallyHidden } from "@/shared/ui";
import type { AccountListDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { AccountRow } from "./account-row";
import { sectionsOf } from "./account-sections";

/** HU-E9-03, the Accounts artboard: the API's totals, then the accounts by type, then the archived ones (P131). */
export function AccountsScreen({
  spaceId,
  list,
  formats,
}: {
  readonly spaceId: string;
  readonly list: AccountListDto;
  readonly formats: Formats;
}) {
  const t = useTranslations("accounts");
  const { active, archived } = sectionsOf(list.items);
  return (
    <div className="flex flex-col gap-6 py-4">
      <header className="flex items-center gap-2">
        <Link
          href={`/spaces/${spaceId}`}
          className="flex size-11 items-center justify-center rounded-xl text-ink"
        >
          <Icon name="back" />
          <VisuallyHidden>{t("backHome")}</VisuallyHidden>
        </Link>
        <h1 className="flex-1 text-2xl font-semibold text-ink">{t("title")}</h1>
        <Link
          href={`/spaces/${spaceId}/accounts/new`}
          className="flex size-11 items-center justify-center rounded-full bg-accent text-on-accent"
        >
          <Icon name="plus" />
          <VisuallyHidden>{t("new")}</VisuallyHidden>
        </Link>
      </header>
      <section aria-label={t("totals")} className="grid grid-cols-2 gap-3">
        <dl className="contents">
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-muted">{t("available")}</dt>
            <dd className="text-xl font-semibold text-ink">{formatMoney(list.totals.available, formats)}</dd>
          </div>
          <div className="rounded-2xl bg-surface p-4">
            <dt className="text-sm text-muted">{t("netWorth")}</dt>
            <dd className="text-xl font-semibold text-ink">{formatMoney(list.totals.netWorth, formats)}</dd>
          </div>
        </dl>
      </section>
      {active.map((section) => (
        <section key={section.key} aria-labelledby={`accounts-${section.key}`}>
          <h2 id={`accounts-${section.key}`} className="mb-1 text-sm font-semibold text-muted">
            {t(`section.${section.key}`)}
          </h2>
          <ul className="divide-y divide-line rounded-2xl bg-surface px-4">
            {section.accounts.map((account) => (
              <AccountRow key={account.id} account={account} formats={formats} />
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
              <AccountRow key={account.id} account={account} formats={formats} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
