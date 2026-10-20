import type { ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { ProfileSheet } from "@/modules/identity/ui";
import { NavLinks } from "./nav-links";
import type { SpaceSummary } from "./space-helpers";
import { SpaceSwitcher } from "./space-switcher";

export interface AppShellProps {
  readonly me: { readonly name: string; readonly email: string; readonly locale: Locale };
  readonly spaces: readonly SpaceSummary[];
  readonly activeSpace: SpaceSummary;
  readonly children: ReactNode;
}

/** HU-E9-01, the Home and Desktop artboards: the header, the navigation of the active space and the page. */
export function AppShell({ me, spaces, activeSpace, children }: AppShellProps) {
  return (
    <div className="min-h-dvh pb-[76px] lg:pb-0 lg:pl-[240px]">
      <div className="mx-auto max-w-[1200px] px-4">
        <header className="flex h-[60px] items-center justify-between">
          <SpaceSwitcher spaces={spaces} activeSpace={activeSpace} />
          <ProfileSheet me={me} spaceId={activeSpace.id} />
        </header>
        <main id="main">{children}</main>
      </div>
      <NavLinks spaceId={activeSpace.id} />
    </div>
  );
}
