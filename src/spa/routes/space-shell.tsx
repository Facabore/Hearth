import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Outlet, useRouter } from "@tanstack/react-router";
import { lazy, useState, type ComponentType, type ReactNode } from "react";
import { AppShell, type SpaceFlows } from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { usePendingCount } from "../recurring-pending/queries";
import { useApis } from "../api";
import { myBalancesQuery, spaceStandingSlot, useShell, useStacked } from "../shell";

const route = getRouteApi("/spaces/$spaceId");

/**
 * Ruling P272: the switcher's "Crear un espacio compartido" and "Unirme con un enlace" sheets ride in the chunk of the
 * New space route, which already holds the create form; `settings.tsx` fills this slot when that chunk loads.
 */
export const spaceFlowsSlot: { current?: SpaceFlows } = {};

type Router = ReturnType<typeof useRouter>;

/**
 * A component another route's chunk fills `slot` with, loaded through the router's own split point for that route the
 * first time it shows: every tab's shell stays as light as it was, and no second import of the chunk (with its own
 * list of files to preload) is written here. The switcher's flows ride in New space's chunk; its cards with the
 * person's standing (ruling P278) in Inicio's, which holds the amount formats.
 */
const useSlot = <P extends object>(
  route: (router: Router) => Parameters<Router["loadRouteChunk"]>[0],
  slot: { current?: ComponentType<P> },
): ComponentType<P> => {
  const router = useRouter();
  const [component] = useState(() =>
    lazy(async () => {
      await router.loadRouteChunk(route(router));
      if (!slot.current) throw new Error("A route's chunk did not fill the shell's slot");
      return { default: slot.current };
    }),
  );
  return component;
};

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
  const spaceFlows = useSlot((router) => router.routesByPath["/spaces/new"], spaceFlowsSlot);
  const spaceStanding = useSlot((router) => router.routesById["/spaces/$spaceId/"], spaceStandingSlot);
  // Ruling P278: the switcher reads the person's balances once it opens (Inicio may have read them already), and only
  // for someone with a shared or direct space.
  const { api } = useApis();
  const [switcherOpened, setSwitcherOpened] = useState(false);
  const shared = shell?.spaces.some((space) => space.kind !== "PERSONAL") ?? false;
  const myBalances = useQuery({ ...myBalancesQuery(api), enabled: switcherOpened && shared }).data;
  // The loader already refused a space the person is not in; this covers leaving it while the screen is open.
  if (!shell) return <NotFoundScreen />;
  return (
    <ToastProvider stacked={stacked}>
      <AppShell
        {...shell}
        pendingCount={pendingCount}
        stacked={stacked}
        spaceFlows={spaceFlows}
        myBalances={shared ? myBalances : undefined}
        spaceStanding={spaceStanding}
        onSwitcherOpen={() => setSwitcherOpened(true)}
      >
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
