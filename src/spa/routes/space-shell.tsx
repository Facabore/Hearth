import { getRouteApi, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { useShell } from "../shell";

const route = getRouteApi("/spaces/$spaceId");

/**
 * The app shell around a screen; ruling P195's toast provider sits above it, as in the Next.js layout. A screen without
 * a space of its own (Settings, New space) passes `from`, and the shell is that space's when it is one of the person's
 * own (N3).
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
  // The loader already refused a space the person is not in; this covers leaving it while the screen is open.
  if (!shell) return <NotFoundScreen />;
  return (
    <ToastProvider>
      <AppShell {...shell}>{children}</AppShell>
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
