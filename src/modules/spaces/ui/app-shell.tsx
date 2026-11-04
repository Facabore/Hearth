import { useEffect, type ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { ProfileSheet } from "@/modules/identity/ui";
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

/** HU-E9-01, the Home and Desktop artboards: the header, the navigation of the active space and the page. */
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
  // Ruling P299: Inter is the signed-in screens' typeface. A first visit to one turns it on before it paints
  // (framePick); this covers arriving from a visitor's page, such as signing in.
  useEffect(() => {
    document.documentElement.dataset.font = "inter";
  }, []);
  if (stacked) {
    return (
      <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-[1200px] px-gutter">
          <main id="main">{children}</main>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-dvh pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[240px]">
      <div className="mx-auto max-w-[1200px] px-gutter">
        <header className="flex h-14 items-center justify-between gap-2">
          <SpaceSwitcher
            spaces={spaces}
            activeSpace={activeSpace}
            flows={spaceFlows}
            personId={me.id}
            formats={me.formats}
            balances={myBalances}
            standing={spaceStanding}
            onOpen={onSwitcherOpen}
          />
          <div className="flex shrink-0 items-center gap-1">
            {/* Inicio's eye sits in the header (board B1 · 03): the screen portals it here (HEADER_SLOT_ID). */}
            <div id="shell-actions" className="contents" />
            <ProfileSheet me={me} spaceId={activeSpace.id} spaceKind={activeSpace.kind} />
          </div>
        </header>
        <main id="main">{children}</main>
      </div>
      <NavLinks
        spaceId={activeSpace.id}
        spaceKind={activeSpace.kind}
        canRecord={controlsFor(activeSpace.role, activeSpace.kind).recordMoney}
        {...(pendingCount === undefined ? {} : { pendingCount })}
      />
    </div>
  );
}
