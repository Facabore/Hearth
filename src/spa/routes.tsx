import {
  createRootRouteWithContext,
  createRoute,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { ThemeSync } from "@/shared/ui/theme/theme-sync";
import { ScreenError } from "./app-error";
import { guardSession, leaveWhenSignedIn, type RouterContext } from "./guards";
import { ensurer } from "./load";
import { accountListQuery, accountQuery, categoriesQuery, signUpModeQuery, spacesQuery } from "./queries";
import { textParam, textsParam } from "./search";
import dynamic from "./next/dynamic";
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
        <NavigationTracker />
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

/**
 * Volver's trail (history.ts): it records from its first render on, and nothing can navigate before the app has
 * rendered, so it loads beside the first screen rather than with the app shell.
 */
const NavigationTracker = dynamic(() =>
  import("@/shared/ui/navigation/navigation-tracker").then((m) => m.NavigationTracker),
);

/** The ledger's loaders load beside each screen's own chunk, never with the app shell. */
const ledger = () => import("./ledger/queries");

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
  validateSearch: (search: Record<string, unknown>) => ({
    joined: textParam(search.joined),
    tx: textParam(search.tx),
  }),
  loaderDeps: ({ search }) => ({ tx: search.tx }),
  loader: async ({ context, params, deps, cause }) =>
    (await ledger()).loadHome({ ...context, cause }, params.spaceId, deps.tx),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "HomePending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/space-home"), "SpaceHome"),
});

/** HU-E9-03: Movimientos, with its filters and the detail sheet behind `?tx=` (P189). */
const transactionsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "transactions",
  validateSearch: (search: Record<string, unknown>) => ({
    period: textParam(search.period),
    category: textParam(search.category),
    payer: textParam(search.payer),
    notice: textParam(search.notice),
    account: textParam(search.account),
    tx: textParam(search.tx),
  }),
  loaderDeps: ({ search }) => ({
    filter: { period: search.period, categoryId: search.category, payerMemberId: search.payer },
    tx: search.tx,
  }),
  loader: async ({ context, params, deps, cause }) =>
    (await ledger()).loadList({ ...context, cause }, params.spaceId, deps.filter, deps.tx),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "ListPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/transactions"), "TransactionsScreen"),
});

/** HU-E9-03: the record form, `?type=` and `?returnTo=` (#172). */
const recordRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "new",
  validateSearch: (search: Record<string, unknown>) => ({
    type: textParam(search.type),
    returnTo: textParam(search.returnTo),
  }),
  loader: async ({ context, params, cause }) =>
    (await ledger()).loadRecord({ ...context, cause }, params.spaceId),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "RecordPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/record"), "RecordScreen"),
});

/** Ruling P191: the edit form, `?returnTo=` the screen its sheet was opened on. */
const editRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "transactions/$transactionId/edit",
  validateSearch: (search: Record<string, unknown>) => ({ returnTo: textParam(search.returnTo) }),
  loader: async ({ context, params, cause }) =>
    (await ledger()).loadEdit({ ...context, cause }, params.spaceId, params.transactionId),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "EditPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/edit-transaction"), "EditTransactionScreen"),
});

/** HU-E9-03: the accounts of a space, every one, archived ones in their own section. */
const accountsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts",
  validateSearch: (search: Record<string, unknown>) => ({ returnTo: textParam(search.returnTo) }),
  loader: ({ context, params, cause }) =>
    ensurer({ ...context, cause })(accountListQuery(context.apis.api, params.spaceId, "all")),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "AccountsPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "AccountsRoute"),
});

/** HU-E9-03: a new account; `?returnTo=` is where saving lands. */
const newAccountRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts/new",
  validateSearch: (search: Record<string, unknown>) => ({ returnTo: textParam(search.returnTo) }),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "NewAccountPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "NewAccountRoute"),
});

/** Issue 169: an account's edit form; one that is gone is not found. */
const editAccountRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts/$accountId/edit",
  loader: ({ context, params, cause }) =>
    ensurer({ ...context, cause })(accountQuery(context.apis.api, params.spaceId, params.accountId)),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "EditAccountPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "EditAccountRoute"),
});

/** HU-E9-04: the category tree of a space, archived groups and categories included. */
const categoriesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "categories",
  loader: ({ context, params, cause }) =>
    ensurer({ ...context, cause })(categoriesQuery(context.apis.api, params.spaceId, "all")),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "CategoriesPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/categories"), "CategoriesRoute"),
});

/** HU-E9-13: Settings, in the shell of the space `?from=` names when it is one of the person's own (N3). */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: (search: Record<string, unknown>) => ({ from: textParam(search.from) }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: ({ context, deps }) => loadShell(context, null, deps.from),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "SettingsPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/settings"), "SettingsRoute"),
});

/** HU-E9-05: a new shared space; `?from=` picks the shell, `?returnTo=` Volver's target. */
const newSpaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "spaces/new",
  validateSearch: (search: Record<string, unknown>) => ({
    from: textParam(search.from),
    returnTo: textParam(search.returnTo),
  }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: ({ context, deps }) => loadShell(context, null, deps.from),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "NewSpacePending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/settings"), "NewSpaceRoute"),
});

export const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([signInRoute, signUpRoute]),
  indexRoute,
  settingsRoute,
  newSpaceRoute,
  spaceRoute.addChildren([
    spaceHomeRoute,
    transactionsRoute,
    recordRoute,
    editRoute,
    accountsRoute,
    newAccountRoute,
    editAccountRoute,
    categoriesRoute,
  ]),
]);
