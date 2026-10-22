import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getMe } from "@/shared/ui/api/server";
import { hasSession } from "@/shared/ui/api/session";
import { serverNow } from "@/shared/ui/time/server-now";
import { LOCALE_COOKIE, resolveLocale } from "./locale";

/** HU-E9-02, ruling P120: no locale in the URL; the signed-in user's stored locale wins. */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  // N2: a failing profile read must not take the whole page down, the error screens included: the visitor's
  // language (cookie, Accept-Language) applies until the API answers again.
  const me = hasSession(cookieStore) ? await getMe().catch(() => null) : null;
  const locale = resolveLocale({
    userLocale: me?.locale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    // next-intl's own formatting is never used (ruling P121); the zone only keeps it from warning.
    timeZone: me?.timezone ?? "America/Bogota",
    now: serverNow(),
  };
});
