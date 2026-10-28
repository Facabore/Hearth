import { Outlet } from "@tanstack/react-router";
import { useLocale } from "use-intl";
import type { Locale } from "@/i18n/locale";
import { LanguageToggle } from "@/modules/identity/ui";
import { Logo } from "@/shared/ui";

/** HU-E9-01: the visitor's screens, as the Next.js public layout draws them. */
export function PublicLayout() {
  const locale = useLocale() as Locale;
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-3 pb-4 max-[359px]:px-3">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <LanguageToggle locale={locale} />
      </div>
      <Outlet />
    </main>
  );
}
