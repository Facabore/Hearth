import {
  createRootRouteWithContext,
  createRoute,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ThemeSync } from "@/shared/ui/theme/theme-sync";
import { guardSession, leaveWhenSignedIn, type RouterContext } from "./guards";
import { signUpModeQuery, spacesQuery } from "./queries";
import { textParam, textsParam } from "./search";
import { loadShell } from "./shell";

/**
 * ADR 0006, slice 1 of #199: the route tree. Paths are the Next.js UI's own, under the `/app` base, and every screen's
 * code is its own chunk (`lazyRouteComponent`), so a route downloads only what it shows.
 */
const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => guardSession(context, location),
  component: function Root() {
    return (
      <>
        <Outlet />
        <ThemeSync />
      </>
    );
  },
});

/** The visitor's screens (HU-E9-01): a signed-in person goes on to `next` instead. */
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  beforeLoad: ({ context, location }) => leaveWhenSignedIn(context, location),
  loader: ({ context }) => context.queryClient.ensureQueryData(signUpModeQuery(context.apis.sessionApi)),
  component: lazyRouteComponent(() => import("./routes/public-layout"), "PublicLayout"),
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "sign-in",
  validateSearch: (search: Record<string, unknown>) => ({
    next: textParam(search.next),
    expired: textParam(search.expired),
    invitation: textsParam(search.invitation),
  }),
  component: lazyRouteComponent(() => import("./routes/sign-in"), "SignInScreen"),
});

const signUpRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "sign-up",
  validateSearch: (search: Record<string, unknown>) => ({
    next: textParam(search.next),
    invitation: textsParam(search.invitation),
  }),
  component: lazyRouteComponent(() => import("./routes/sign-up"), "SignUpScreen"),
});

/** Ruling P125: "/" opens the signed-in person's personal space. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: async ({ context }) => {
    const spaces = await context.queryClient.ensureQueryData(spacesQuery(context.apis.api));
    throw redirect({ href: `/spaces/${personalSpaceOf(spaces).id}`, replace: true });
  },
});

/** The app shell of a space: its header with the space switcher and profile, and the bottom navigation. */
const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "spaces/$spaceId",
  loader: ({ context, params }) => loadShell(context, params.spaceId),
  component: lazyRouteComponent(() => import("./routes/space-shell"), "SpaceShell"),
});

const spaceHomeRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./routes/space-home"), "SpaceHome"),
});

export const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([signInRoute, signUpRoute]),
  indexRoute,
  spaceRoute.addChildren([spaceHomeRoute]),
]);
