import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { LanguageToggle } from "@/modules/identity/ui";
import { Logo } from "@/shared/ui";
import { getMe } from "@/shared/ui/api/server";
import { hasSession } from "@/shared/ui/api/session";

/** HU-E9-01: the visitor's screens. A real session check (not only a cookie), so an expired cookie never loops. */
export default async function PublicLayout({ children }: { readonly children: ReactNode }) {
  if (hasSession(await cookies()) && (await getMe()) !== null) redirect("/");
  const locale = (await getLocale()) as Locale;
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-4 pb-6">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <LanguageToggle locale={locale} />
      </div>
      {children}
    </main>
  );
}
