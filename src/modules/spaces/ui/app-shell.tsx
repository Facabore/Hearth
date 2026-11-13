import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { ProfileSheet } from "@/modules/identity/ui";
import { Icon } from "@/shared/ui";
import type { Formats } from "@/shared/ui/format/formatters";
import { controlsFor } from "./members/space-controls";
import { NavLinks } from "./nav-links";
import type { SpaceSummary } from "./space-helpers";
import type { MyBalanceDto, SpaceStandingView } from "./space-standing";
import { SpaceSwitcher, type SpaceFlows } from "./space-switcher";

export interface AppShellProps {
  readonly me: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly locale: Locale;
    /** The person's effective formats (P121), for the amounts the switcher shows. */
    readonly formats?: Pick<Formats, "numberFormat">;
  };
  readonly spaces: readonly SpaceSummary[];
  readonly activeSpace: SpaceSummary;
  /** HU-E9-09 (ruling P270): the active space's pending occurrences, for the Movimientos badge. */
  readonly pendingCount?: number;
  /**
   * Ruling P272: a stacked screen (its board draws only its own back header) shows no space switcher, profile or
   * navigation; its `ScreenHeader` is the way back. The tab destinations keep them.
   */
  readonly stacked?: boolean;
  /** The switcher's "Crear un espacio compartido" and "Unirme con un enlace" sheets, loaded on demand by the app. */
  readonly spaceFlows?: SpaceFlows;
  /** Ruling P278: the person's standing in each shared space, and the cards that draw it, once the app has them. */
  readonly myBalances?: readonly MyBalanceDto[] | undefined;
  readonly spaceStanding?: SpaceStandingView | undefined;
  /** The switcher opened: the app reads the balances then, not with every tab. */
  readonly onSwitcherOpen?: () => void;
  readonly children: ReactNode;
}

/**
 * HU-E9-01, the Home and Desktop artboards: the header, the navigation of the active space and the page. Ruling P311:
 * the header reads [space switcher] … [⚙] [profile] on every tab destination; the ⚙ opens the active space's
 * Configuración.
 */
/**
 * Ruling P325: each screen arrives with a short fade and rise. The stylesheet plays it on the wrapper's children as they
 * mount, so a new screen plays it and a change of the query (a filter, a period, an open sheet), or the same screen in
 * another space (Registrar moved with what was typed, P305), keeps its elements and does not. The wrapper is never keyed
 * by the address: the address changes before the router draws the next screen, so a key would mount that screen again
 * and lose what it took on mounting, such as the amount Registrar gets back from Crear un fondo (P321).
 */
function Screen({ children }: { readonly children: ReactNode }) {
  return <div className="motion-screen">{children}</div>;
}

export function AppShell({
  me,
  spaces,
  activeSpace,
  pendingCount,
  stacked = false,
  spaceFlows,
  myBalances,
  spaceStanding,
  onSwitcherOpen,
  children,
}: AppShellProps) {
  const t = useTranslations("shell");
  // Ruling P299: Inter is the signed-in screens' typeface. A first visit to one turns it on before it paints
  // (framePick); this covers arriving from a visitor's page, such as signing in.
  useEffect(() => {
    document.documentElement.dataset.font = "inter";
  }, []);
  if (stacked) {
    return (
      <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-[1200px] px-gutter">
          <main id="main">
            <Screen>{children}</Screen>
          </main>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-dvh pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[240px]">
      {/* #290 (audit pass 3, A17): the first Tab offers to skip the header and land on the screen itself. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:font-medium focus:text-ink"
      >
        {t("skip")}
      </a>
      <div className="mx-auto max-w-[1200px] px-gutter">
        <header className="flex h-14 items-center justify-between gap-2">
          <SpaceSwitcher
            spaces={spaces}
            activeSpace={activeSpace}
            flows={spaceFlows}
            formats={me.formats}
            balances={myBalances}
            standing={spaceStanding}
            onOpen={onSwitcherOpen}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href={`/spaces/${activeSpace.id}/settings`}
              aria-label={t("settings", { name: activeSpace.name })}
              className="flex size-11 items-center justify-center rounded-full text-ink"
            >
              <Icon name="sliders" />
            </Link>
            <ProfileSheet me={me} spaceId={activeSpace.id} />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="outline-none">
          <Screen>{children}</Screen>
        </main>
      </div>
      <NavLinks
        spaceId={activeSpace.id}
        homeSpaceId={spaces.find((space) => space.kind === "PERSONAL")?.id ?? activeSpace.id}
        canRecord={controlsFor(activeSpace.role, activeSpace.kind).recordMoney}
        {...(pendingCount === undefined ? {} : { pendingCount })}
      />
    </div>
  );
}
