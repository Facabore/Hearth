import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";

/**
 * HU-E9-09 (ruling P270): Movimientos' way to "Por confirmar", under its title, "{n} movimientos por confirmar ·
 * Revisar". The screen shows it only to a member who records money, and only while something waits.
 */
export function PendingBanner({ spaceId, count }: { readonly spaceId: string; readonly count: number }) {
  const t = useTranslations("recurrences.pending");
  return (
    <section
      aria-label={t("title")}
      className="flex items-center gap-3 rounded-2xl bg-accent-soft p-3 text-accent"
    >
      <Icon name="check" />
      <p className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{t("banner", { count })}</p>
      <Link
        href={`/spaces/${spaceId}/pending-occurrences`}
        className="flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent"
      >
        {t("review")}
      </Link>
    </section>
  );
}
