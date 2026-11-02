import { getRouteApi, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { usePendingCount } from "../recurring-pending/queries";
import { useShell, useStacked } from "../shell";

const route = getRouteApi("/spaces/$spaceId");

/**
 * The app shell around a screen; ruling P195's toast provider sits above it, as in the Next.js layout. A screen without
 * a space of its own (Settings, New space) passes `from`, and the shell is that space's when it is one of the person's
 * own (N3). A stacked screen (ruling P272, its route's `staticData`) gets the shell without its switcher and bar.
 */
export function ShellFrame({
  spaceId,
  from,
  children,
}: {
  readonly spaceId: string | null;
  readonly from?: string | undefined;
  readonly children: ReactNode;
}) {
  const shell = useShell(spaceId, from);
  const stacked = useStacked();
  // HU-E9-09 (ruling P270): the Movimientos badge counts the active space's pending occurrences.
  const pendingCount = usePendingCount(shell?.activeSpace ?? null);
  // The loader already refused a space the person is not in; this covers leaving it while the screen is open.
  if (!shell) return <NotFoundScreen />;
  return (
    <ToastProvider stacked={stacked}>
      <AppShell {...shell} pendingCount={pendingCount} stacked={stacked}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}

/** A space's screens inside the app shell. */
export function SpaceShell() {
  return (
    <ShellFrame spaceId={route.useParams().spaceId}>
      <Outlet />
    </ShellFrame>
  );
}
