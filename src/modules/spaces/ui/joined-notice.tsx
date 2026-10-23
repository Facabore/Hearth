import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";

/**
 * U6: the one-time confirmation after accepting an invitation or a claim link (`?joined=1`), in the saved notice's
 * pattern: a status the person can dismiss, which replaces the entry so Back never returns to it.
 */
export function JoinedNotice({
  space,
  dismissHref,
}: {
  readonly space: string;
  readonly dismissHref: string;
}) {
  const t = useTranslations("spaces.joined");
  const common = useTranslations("ledger.saved");
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-ink"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-accent">
        <Icon name="check" size={22} />
      </span>
      <p className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{t("title", { space })}</p>
      <Link
        href={dismissHref}
        replace
        aria-label={common("dismiss")}
        className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
      >
        <Icon name="close" size={20} />
      </Link>
    </div>
  );
}
