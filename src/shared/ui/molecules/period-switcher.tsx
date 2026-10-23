import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "../atoms/icon";
import { VisuallyHidden } from "../atoms/visually-hidden";

const BOX = "flex size-11 shrink-0 items-center justify-center rounded-full text-ink";

/**
 * HU-E9-10 (the Lines artboard's header, ruling P205): the period as the page's heading between links to its
 * neighbours. A missing neighbour leaves a 44 px spacer, so the heading stays centred.
 */
export function PeriodSwitcher({
  title,
  previousHref,
  nextHref,
}: {
  readonly title: string;
  readonly previousHref: string | null;
  readonly nextHref: string | null;
}) {
  const t = useTranslations("common");
  return (
    <div className="flex items-center justify-between">
      {previousHref === null ? (
        <span className="size-11 shrink-0" />
      ) : (
        <Link href={previousHref} className={BOX}>
          <Icon name="back" />
          <VisuallyHidden>{t("previousPeriod")}</VisuallyHidden>
        </Link>
      )}
      <h1 className="text-lg font-semibold text-ink first-letter:uppercase">{title}</h1>
      {nextHref === null ? (
        <span className="size-11 shrink-0" />
      ) : (
        <Link href={nextHref} className={BOX}>
          <Icon name="chevronRight" />
          <VisuallyHidden>{t("nextPeriod")}</VisuallyHidden>
        </Link>
      )}
    </div>
  );
}
