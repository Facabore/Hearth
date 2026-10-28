import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/locale";
import { useApis } from "./api";
import { localeEpoch, subscribeLocale } from "./locale-epoch";
import { meQuery } from "./queries";

/** Each catalog is its own chunk: a person downloads only the language they read (ADR 0006). */
const CATALOGS: Record<Locale, () => Promise<{ default: unknown }>> = {
  es: () => import("@/i18n/messages/es.json"),
  en: () => import("@/i18n/messages/en.json"),
};

export const catalogQuery = (locale: Locale) =>
  queryOptions({
    queryKey: ["i18n", locale] as const,
    queryFn: async () => (await CATALOGS[locale]()).default as AbstractIntlMessages,
    staleTime: Infinity,
    gcTime: Infinity,
  });

const cookieLocale = (): string | null =>
  document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1) ?? null;

/** HU-E9-02, ruling P120 as `src/i18n/request.ts` applies it: the stored locale, the visitor cookie, the browser's. */
export const visitorLocale = (userLocale?: string | null): Locale =>
  resolveLocale({ userLocale, cookieLocale: cookieLocale(), acceptLanguage: navigator.languages.join(",") });

/**
 * The texts of the whole app (use-intl over the existing catalogs). It waits for the profile, so a signed-in person
 * never sees a frame in the visitor's language, then for the catalog; a language change keeps the old texts until the
 * new ones are in. Formats never come from here (D23, P121): only `src/shared/ui/format/` formats.
 */
export function IntlRoot({ children }: { readonly children: ReactNode }) {
  const { sessionApi } = useApis();
  const me = useQuery(meQuery(sessionApi));
  // A refresh may have changed the language cookie: render again and read it (the profile's language wins anyway).
  useSyncExternalStore(subscribeLocale, localeEpoch);
  const locale = visitorLocale(me.data?.locale);
  const messages = useQuery({
    ...catalogQuery(locale),
    placeholderData: keepPreviousData,
    enabled: !me.isPending,
  });
  useEffect(() => {
    if (messages.data && !messages.isPlaceholderData) document.documentElement.lang = locale;
  }, [locale, messages.data, messages.isPlaceholderData]);
  if (me.isPending || !messages.data) return null;
  return (
    <IntlProvider
      locale={messages.isPlaceholderData ? (document.documentElement.lang as Locale) : locale}
      messages={messages.data}
      // use-intl's own formatting is never used (ruling P121); the zone only keeps it from warning.
      timeZone={me.data?.timezone ?? "America/Bogota"}
    >
      {children}
    </IntlProvider>
  );
}
