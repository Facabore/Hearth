import { getRouteApi, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { useShell } from "../shell";

const route = getRouteApi("/spaces/$spaceId");

/** A space's screens inside the app shell; ruling P195's toast provider sits above them, as in the Next.js layout. */
export function SpaceShell() {
  const shell = useShell(route.useParams().spaceId);
  // The loader already refused a space the person is not in; this covers leaving it while the screen is open.
  if (!shell) return <NotFoundScreen />;
  return (
    <ToastProvider>
      <AppShell {...shell}>
        <Outlet />
      </AppShell>
    </ToastProvider>
  );
}
