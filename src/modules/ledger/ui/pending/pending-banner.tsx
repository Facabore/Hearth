import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";

/**
 * HU-E9-09 (ruling P270): Movimientos' way to "Por confirmar", under its title, "{n} movimientos por confirmar ·
 * Revisar". The screen shows it only to a member who records money, and only while something waits.
 */
export function PendingBanner({
  spaceId,
  count,
  names = [],
}: {
  readonly spaceId: string;
  readonly count: number;
  /** What waits, earliest first: the line under the count names the first two and how many more. */
  readonly names?: readonly string[];
}) {
  const t = useTranslations("recurrences.pending");
  const [first, second] = names;
  const line =
    first === undefined
      ? null
      : second === undefined
        ? first
        : names.length === 2
          ? t("names.two", { first, second })
          : t("names.more", { first, second, rest: names.length - 2 });
  return (
    <section
      aria-label={t("title")}
      className="flex items-center gap-3 rounded-2xl bg-accent-soft p-3 text-accent"
    >
      <Icon name="check" />
      <p className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
        <span className="font-semibold">{t("banner", { count })}</span>
        {line ? <span className="text-sm text-ink">{line}</span> : null}
      </p>
      <Link
        href={`/spaces/${spaceId}/pending-occurrences`}
        className="flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent"
      >
        {t("review")}
      </Link>
    </section>
  );
}
