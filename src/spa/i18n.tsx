import {
  queryOptions,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { useMatches, type StaticDataRouteOption } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { IntlProvider, useLocale, useMessages, useTimeZone, type AbstractIntlMessages } from "use-intl";
import type { Area } from "@/i18n/areas";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "@/i18n/locale";
import { mergeMessages, type Messages } from "@/i18n/merge";
import { useApis } from "./api";
import type { RouterContext } from "./guards";
import { localeEpoch, subscribeLocale } from "./locale-epoch";
import { meQuery } from "./queries";

/** Each catalog is its own chunk: a person downloads only the language they read (ADR 0006). */
const CATALOGS: Record<Locale, () => Promise<{ default: unknown }>> = {
  es: () => import("@/i18n/messages/es.json"),
  en: () => import("@/i18n/messages/en.json"),
};

/**
 * Ruling P276 (#235): the core catalog holds what the shell, the pending screens and every screen of more than one area
 * read; each area's own copy is a chunk per language that loads with the area's routes, never with the others'.
 */
const AREA_CATALOGS: Record<Area, Record<Locale, () => Promise<{ default: unknown }>>> = {
  plan: {
    es: () => import("@/i18n/messages/areas/plan.es.json"),
    en: () => import("@/i18n/messages/areas/plan.en.json"),
  },
  recurrences: {
    es: () => import("@/i18n/messages/areas/recurrences.es.json"),
    en: () => import("@/i18n/messages/areas/recurrences.en.json"),
  },
  categories: {
    es: () => import("@/i18n/messages/areas/categories.es.json"),
    en: () => import("@/i18n/messages/areas/categories.en.json"),
  },
  members: {
    es: () => import("@/i18n/messages/areas/members.es.json"),
    en: () => import("@/i18n/messages/areas/members.en.json"),
  },
  accounts: {
    es: () => import("@/i18n/messages/areas/accounts.es.json"),
    en: () => import("@/i18n/messages/areas/accounts.en.json"),
  },
  settings: {
    es: () => import("@/i18n/messages/areas/settings.es.json"),
    en: () => import("@/i18n/messages/areas/settings.en.json"),
  },
  invitation: {
    es: () => import("@/i18n/messages/areas/invitation.es.json"),
    en: () => import("@/i18n/messages/areas/invitation.en.json"),
  },
  trust: {
    es: () => import("@/i18n/messages/areas/trust.es.json"),
    en: () => import("@/i18n/messages/areas/trust.en.json"),
  },
};

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Ruling P276: the catalog areas the route's screen reads, loaded by its loader before it renders. */
    readonly areas?: readonly Area[];
  }
}

export const catalogQuery = (locale: Locale) =>
  queryOptions({
    queryKey: ["i18n", locale] as const,
    queryFn: async () => (await CATALOGS[locale]()).default as AbstractIntlMessages,
    staleTime: Infinity,
    gcTime: Infinity,
  });

/** An area's catalog in one language; like the core's, kept for good once in and kept on a failed load. */
export const areaCatalogQuery = (area: Area, locale: Locale) =>
  queryOptions({
    queryKey: ["i18n", locale, area] as const,
    queryFn: async () => (await AREA_CATALOGS[area][locale]()).default as AbstractIntlMessages,
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
 * A route's loader: the areas its `staticData` names, in the language the texts will show (the profile's, as
 * `IntlRoot` picks it), in the query cache before its screen renders.
 */
export const loadAreas = async (
  { queryClient, apis }: RouterContext,
  route: { readonly options: { readonly staticData?: StaticDataRouteOption } },
): Promise<void> => {
  const areas = route.options.staticData?.areas ?? [];
  if (areas.length === 0) return;
  const me = await queryClient.ensureQueryData(meQuery(apis.sessionApi)).catch(() => null);
  const locale = visitorLocale(me?.locale);
  await Promise.all(areas.map((area) => queryClient.ensureQueryData(areaCatalogQuery(area, locale))));
};

/** A loader's data once its areas are in too; `areas` is started first, so both download side by side. */
export const withAreas = async <T,>(areas: Promise<void>, data: T | Promise<T>): Promise<T> =>
  (await Promise.all([areas, data]))[1];

/** The areas the screens on show read, as `AreaMessages` reports them; a language change loads them too. */
const shownAreas = new Map<Area, number>();
const areaListeners = new Set<() => void>();
let shownSnapshot: readonly Area[] = [];

const showAreas = (areas: readonly Area[]): (() => void) => {
  const change = (by: number) => {
    for (const area of areas) {
      const count = (shownAreas.get(area) ?? 0) + by;
      if (count > 0) shownAreas.set(area, count);
      else shownAreas.delete(area);
    }
    shownSnapshot = [...shownAreas.keys()].sort();
    for (const listener of areaListeners) listener();
  };
  change(1);
  return () => change(-1);
};

const subscribeAreas = (listener: () => void): (() => void) => {
  areaListeners.add(listener);
  return () => areaListeners.delete(listener);
};

const areasOnShow = (): readonly Area[] => shownSnapshot;

const unique = (areas: readonly Area[]): Area[] => [...new Set(areas)].sort();

/**
 * Several areas' catalogs in one language, as one query over each area's own: at once from the cache when every one
 * is in, else once they load. One query, not `useQueries`, whose observer would join the app's script (slice 5 of #199).
 */
const areasQuery = (queryClient: QueryClient, areas: readonly Area[], locale: Locale) =>
  queryOptions({
    queryKey: ["i18n", locale, "areas", areas.join(",")] as const,
    queryFn: () =>
      Promise.all(areas.map((area) => queryClient.ensureQueryData(areaCatalogQuery(area, locale)))),
    initialData: () => {
      const catalogs = areas.map((area) => queryClient.getQueryData(areaCatalogQuery(area, locale).queryKey));
      return catalogs.every((catalog) => catalog !== undefined) ? catalogs : undefined;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

/**
 * Ruling P276: the area catalogs of the routes on show, merged into the texts below the root route. A rendered screen's
 * areas are always in, since its loader waited for them and a language changes only once its areas are in; should one
 * be missing anyway, the screens wait for it rather than show a key. A pending screen's areas join once they are in.
 */
export function AreaMessages({ children }: { readonly children: ReactNode }) {
  const matches = useMatches();
  const locale = useLocale() as Locale;
  const core = useMessages();
  const timeZone = useTimeZone();
  const queryClient = useQueryClient();
  const settled = unique(
    matches.flatMap((match) => (match.status === "success" ? (match.staticData.areas ?? []) : [])),
  );
  const pending = unique(matches.flatMap((match) => match.staticData.areas ?? [])).filter(
    (area) => !settled.includes(area),
  );
  const required = useSuspenseQuery(areasQuery(queryClient, settled, locale)).data;
  const loaded = [
    ...required.map((data, i) => [settled[i]!, data] as const),
    ...pending.flatMap((area) => {
      const data = queryClient.getQueryData(areaCatalogQuery(area, locale).queryKey);
      return data ? [[area, data] as const] : [];
    }),
  ];
  const onShow = unique([...settled, ...pending]).join(",");
  useEffect(() => showAreas(onShow === "" ? [] : (onShow.split(",") as Area[])), [onShow]);
  const loadedKey = loaded.map(([area]) => area).join(",");
  // Each area's catalog is the same object for good (staleTime Infinity), so its name and the language name the merge.
  const messages = useMemo(
    () =>
      loaded.length === 0
        ? null
        : (mergeMessages(
            core as Messages,
            ...loaded.map(([, data]) => data as Messages),
          ) as AbstractIntlMessages),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` is named by `loadedKey` and `locale`.
    [core, locale, loadedKey],
  );
  if (!messages) return children;
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </IntlProvider>
  );
}

/**
 * The words of the screen below, written here and not in `src/i18n/messages/`: it shows when the first catalog could not
 * load (#201), so it cannot read its texts from one. Keep it to these few lines, in both languages.
 */
const CATALOG_FAILED: Record<Locale, { title: string; body: string; retry: string }> = {
  es: {
    title: "No pudimos cargar Hearth",
    body: "Revisa tu conexión e inténtalo de nuevo.",
    retry: "Reintentar",
  },
  en: { title: "We couldn't load Hearth", body: "Check your connection and try again.", retry: "Try again" },
};

/** A first visit whose catalog did not load even after its retry: said in the visitor's language, with Reintentar. */
function CatalogFailed({ locale, onRetry }: { readonly locale: Locale; readonly onRetry: () => void }) {
  const copy = CATALOG_FAILED[locale];
  return (
    <main lang={locale} className="mx-auto flex max-w-[420px] flex-col gap-3 px-gutter py-6">
      <h1 className="text-2xl font-semibold text-ink">{copy.title}</h1>
      <p className="text-muted">{copy.body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-14 w-full items-center justify-center rounded-[14px] bg-accent px-6 text-base font-semibold text-on-accent"
      >
        {copy.retry}
      </button>
    </main>
  );
}

/**
 * The texts of the whole app (use-intl over the existing catalogs). It waits for the profile, so a signed-in person
 * never sees a frame in the visitor's language, then for the catalog. A language change keeps the texts on screen until
 * the new ones are in, the core and the areas on show (ruling P276), and keeps them if one cannot load (a flaky network,
 * a chunk gone after a release); a first catalog that cannot load says so (`CatalogFailed`). Formats never come from here (D23, P121): only `src/shared/ui/format/` formats.
 */
export function IntlRoot({ children }: { readonly children: ReactNode }) {
  const { sessionApi } = useApis();
  const me = useQuery(meQuery(sessionApi));
  // A refresh may have changed the language cookie: render again and read it (the profile's language wins anyway).
  useSyncExternalStore(subscribeLocale, localeEpoch);
  const locale = visitorLocale(me.data?.locale);
  const core = useQuery({ ...catalogQuery(locale), enabled: !me.isPending });
  const catalog = core.data;
  const queryClient = useQueryClient();
  const areas = useSyncExternalStore(subscribeAreas, areasOnShow);
  const onShow = useQuery({ ...areasQuery(queryClient, areas, locale), enabled: !me.isPending });
  const areasIn = onShow.data !== undefined;
  const [shown, setShown] = useState<{ locale: Locale; messages: AbstractIntlMessages } | null>(null);
  if (catalog && areasIn && (shown?.locale !== locale || shown.messages !== catalog))
    setShown({ locale, messages: catalog });
  useEffect(() => {
    if (shown) document.documentElement.lang = shown.locale;
  }, [shown]);
  if (me.isPending) return null;
  if (!shown) {
    if (!core.isError && !onShow.isError) return null;
    return (
      <CatalogFailed
        locale={locale}
        onRetry={() => {
          if (core.isError) void core.refetch();
          if (onShow.isError) void onShow.refetch();
        }}
      />
    );
  }
  return (
    <IntlProvider
      locale={shown.locale}
      messages={shown.messages}
      // use-intl's own formatting is never used (ruling P121); the zone only keeps it from warning.
      timeZone={me.data?.timezone ?? "America/Bogota"}
    >
      {children}
    </IntlProvider>
  );
}
