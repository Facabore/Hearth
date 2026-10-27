import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { LanguageToggle } from "@/modules/identity/ui";
import { Logo } from "@/shared/ui";

/**
 * Ruling P157: the invitation and claim pages. Anyone may open them, signed in or not, so unlike the public layout
 * this one checks no session and never redirects; each page reads the session it needs.
 */
export default async function OpenLayout({ children }: { readonly children: ReactNode }) {
  const locale = (await getLocale()) as Locale;
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-3 pb-4 max-[359px]:px-3">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <LanguageToggle locale={locale} />
      </div>
      {children}
    </main>
  );
}
