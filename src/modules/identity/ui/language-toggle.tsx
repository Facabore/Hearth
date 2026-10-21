"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { localeCookie, type Locale } from "@/i18n/locale";

/**
 * Ruling P120: a visitor's language, kept in a cookie; the texts reload without a locale in the URL. Ruling P152: it
 * writes only that cookie, never the stored locale, which changes only in Settings.
 */
export function LanguageToggle({ locale }: { readonly locale: Locale }) {
  const t = useTranslations("auth.language");
  const router = useRouter();
  const other: Locale = locale === "es" ? "en" : "es";
  return (
    <button
      type="button"
      aria-label={t("label", { language: t(locale) })}
      onClick={() => {
        document.cookie = localeCookie(other);
        router.refresh();
      }}
      className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink"
    >
      {t("short")}
    </button>
  );
}
