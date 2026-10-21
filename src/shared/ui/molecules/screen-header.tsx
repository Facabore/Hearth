import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon } from "../atoms/icon";

/**
 * The header of a screen below the navigation (the Members artboard's): a 48 px Volver link to an explicit parent
 * route (a real link, so a deep link or a new tab still has a way out), the title and an optional subtitle. An
 * `action` sits after the title.
 */
export function ScreenHeader({
  backHref,
  title,
  subtitle,
  action,
}: {
  readonly backHref: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <header className="flex items-center gap-2">
      <Link
        href={backHref}
        aria-label={t("back")}
        className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
      >
        <Icon name="back" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="min-w-0 text-2xl font-semibold [overflow-wrap:anywhere] text-ink">{title}</h1>
        {subtitle ? <p className="text-sm break-words text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
