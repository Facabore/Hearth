import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { LanguageToggle } from "@/modules/identity/ui";
import { ErrorScreen, Logo } from "@/shared/ui";
import { getMe } from "@/shared/ui/api/server";
import { PATH_HEADER } from "@/shared/ui/api/server-headers";
import { hasSession } from "@/shared/ui/api/session";
import { nextFromPath } from "@/shared/ui/navigation/auth-redirect";

/**
 * HU-E9-01: the visitor's screens. A real session check (not only a cookie), so an expired cookie never loops. N4: a
 * signed-in person goes to the screen `next` names (made safe), not always to the home. N2: when the API does not
 * answer, the screen says so and offers a retry, instead of Next's bare error page.
 */
export default async function PublicLayout({ children }: { readonly children: ReactNode }) {
  let signedIn = false;
  let unreachable = false;
  if (hasSession(await cookies())) {
    try {
      signedIn = (await getMe()) !== null;
    } catch {
      unreachable = true;
    }
  }
  if (signedIn) redirect(nextFromPath((await headers()).get(PATH_HEADER)));
  const locale = (await getLocale()) as Locale;
  return (
    <main className="mx-auto max-w-[420px] px-4 pt-3 pb-4 max-[359px]:px-3">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <LanguageToggle locale={locale} />
      </div>
      {unreachable ? <ErrorScreen variant="connection" /> : children}
    </main>
  );
}
