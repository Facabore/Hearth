"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon } from "../atoms/icon";
import { goBack } from "../navigation/history";

/**
 * The header of a screen below the navigation (#171): 48 px tall, a 48 px Volver link, a 17 px title and an
 * optional subtitle. The link is a real `<a href>` to the explicit parent route, which a deep link, a new tab and a
 * visitor without JavaScript follow; a click returns to where the person was instead (`goBack`). An `action` sits
 * after the title.
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
    <header className="flex min-h-12 items-center gap-2">
      <Link
        href={backHref}
        onClick={goBack}
        aria-label={t("back")}
        className="-ml-2 flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
      >
        <Icon name="back" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="min-w-0 text-[17px] leading-tight font-semibold [overflow-wrap:anywhere] text-ink">
          {title}
        </h1>
        {subtitle ? <p className="text-sm break-words text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
