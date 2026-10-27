import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

/**
 * HU-E9-06, the FundWarning artboard (ruling P170): the expense was saved, and a shared fund is now negative. A
 * status, not an error: nothing failed. The balance is the fund's current one, read by the list, not from the address.
 */
export function SavedNotice({
  accountName,
  balance,
  formats,
  dismissHref,
}: {
  readonly accountName: string;
  readonly balance: MoneyDto;
  readonly formats: Formats;
  readonly dismissHref: string;
}) {
  const t = useTranslations("ledger");
  const w = useTranslations("warnings");
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-owe/30 bg-owe-soft p-3 text-ink"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-owe">
        <Icon name="warning" size={22} />
      </span>
      <p className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold">{t("saved.title")}</span>
        <span className="text-sm">
          {w("FundBalanceNegative", { account: accountName, balance: formatMoney(balance, formats) })}
        </span>
      </p>
      {/* N8: dismissing only changes the query, so it replaces the entry and Back never returns to the notice. */}
      <Link
        href={dismissHref}
        replace
        aria-label={t("saved.dismiss")}
        className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
      >
        <Icon name="close" size={20} />
      </Link>
    </div>
  );
}
