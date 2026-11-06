import { Suspense } from "react";
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
import { AreaMessages, loadAreas, withAreas } from "./i18n";
import { signUpModeQuery, spacesQuery } from "./queries";
import { textParam, textsParam } from "./search";
import { loadShell } from "./shell";

/**
 * ADR 0006, slice 1 of #199: the route tree. Paths are the Next.js UI's own, at the root since the cut-over, and every screen's
 * code is its own chunk (`lazyRouteComponent`), so a route downloads only what it shows.
 */
const rootRoute = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ context, location }) => guardSession(context, location),
  component: function Root() {
    return (
      <>
        {/* Ruling P276: each screen's area catalogs, merged into the texts; only a missing one waits, never a key. */}
        <Suspense fallback={null}>
          <AreaMessages>
            <Outlet />
          </AreaMessages>
        </Suspense>
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

/** The ledger's loaders load beside each screen's own chunk, never with the app shell. */
const ledger = () => import("./ledger/queries");

/** Slice 3's loaders, likewise. */
const manage = () => import("./manage/loaders");

/** The shared spaces' loaders, likewise. */
const sharedSpaces = () => import("./spaces/loaders");

/** The Plan tab's and the planner's loaders, likewise. */
const plans = () => import("./plan/loaders");

/** HU-E9-09's loaders, likewise. */
const recurring = () => import("./recurring/loaders");

/** A Plan tab view's query string (ruling P200): the period, the trend's window and the calendar's days. */
const planSearch = (search: Record<string, unknown>) => ({
  period: textParam(search.period),
  periods: textParam(search.periods),
  days: textParam(search.days),
});

/**
 * Ruling P272: a stacked screen, drawn by its board with only its back header: the shell shows no space switcher and
 * no bottom navigation around it. The tab destinations (Inicio, Movimientos, the Plan views, Saldos) leave it out, and
 * so does the edit form for now. The record form is one too, drawn as a sheet with its own scrim (ruling P291).
 */
const stackedScreen = { stacked: true } as const;

const planPending = lazyRouteComponent(() => import("./routes/pending"), "PlanPending");
const plannerPending = lazyRouteComponent(() => import("./routes/pending"), "PlannerPending");

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

/** HU-E9-03: the record form, `?type=` and `?returnTo=` (#172); a sheet over a stacked shell (P291). */
const recordRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "new",
  staticData: stackedScreen,
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

/** Ruling P270: "Por confirmar", the space's pending occurrences, opened from the Movimientos banner. */
const pendingOccurrencesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "pending-occurrences",
  staticData: { ...stackedScreen, areas: ["recurrences"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await recurring()).loadPendingOccurrences({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "ListPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/pending-occurrences"), "PendingOccurrencesRoute"),
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

/** HU-E9-09 (P270): the space's recurring movements, opened from the Recurrentes pill of Movimientos. */
const recurrencesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "recurrences",
  staticData: { ...stackedScreen, areas: ["recurrences"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await recurring()).loadRecurrences({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "RecurrencesPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/recurrences"), "RecurrencesRoute"),
});

const newRecurrenceRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "recurrences/new",
  staticData: { ...stackedScreen, areas: ["recurrences"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await recurring()).loadRecurrenceForm({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "RecurrenceFormPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/recurrences"), "NewRecurrenceRoute"),
});

/** One recurrence: its next dates, pause, resume, extend and end; one that is gone is not found. */
const recurrenceRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "recurrences/$recurrenceId",
  staticData: { ...stackedScreen, areas: ["recurrences"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await recurring()).loadRecurrence({ ...context, cause }, params.spaceId, params.recurrenceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "RecurrencePending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/recurrences"), "RecurrenceRoute"),
});

const editRecurrenceRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "recurrences/$recurrenceId/edit",
  staticData: { ...stackedScreen, areas: ["recurrences"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await recurring()).loadRecurrenceEdit({ ...context, cause }, params.spaceId, params.recurrenceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "RecurrenceFormPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/recurrences"), "EditRecurrenceRoute"),
});

/** HU-E9-03: the accounts of a space, every one, archived ones in their own section. */
const accountsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts",
  staticData: { ...stackedScreen, areas: ["accounts"] },
  validateSearch: (search: Record<string, unknown>) => ({ returnTo: textParam(search.returnTo) }),
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await manage()).loadAccounts({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "AccountsPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "AccountsRoute"),
});

/** HU-E9-03: a new account, a sheet over Cuentas (P292); `?returnTo=` is where saving lands. */
const newAccountRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts/new",
  staticData: { ...stackedScreen, areas: ["accounts"] },
  validateSearch: (search: Record<string, unknown>) => ({ returnTo: textParam(search.returnTo) }),
  // The sheet's Cuentas reads its list through the query, which Cuentas has usually cached already.
  loader: ({ context, route }) => loadAreas(context, route),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "NewAccountPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "NewAccountRoute"),
});

/** Issue 169: an account's edit form; one that is gone is not found. */
const editAccountRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "accounts/$accountId/edit",
  staticData: { ...stackedScreen, areas: ["accounts"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await manage()).loadAccount({ ...context, cause }, params.spaceId, params.accountId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "EditAccountPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/accounts"), "EditAccountRoute"),
});

/** HU-E9-04: the category tree of a space, archived groups and categories included. */
const categoriesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "categories",
  staticData: { ...stackedScreen, areas: ["categories"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await manage()).loadCategories({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "CategoriesPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/categories"), "CategoriesRoute"),
});

/** HU-E9-13: Settings, in the shell of the space `?from=` names when it is one of the person's own (N3). */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  staticData: { ...stackedScreen, areas: ["settings"] },
  validateSearch: (search: Record<string, unknown>) => ({ from: textParam(search.from) }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: ({ context, deps, route }) =>
    withAreas(loadAreas(context, route), loadShell(context, null, deps.from)),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "SettingsPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/settings"), "SettingsRoute"),
});

/** HU-E9-05: a new shared space; `?from=` picks the shell, `?returnTo=` Volver's target. */
const newSpaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "spaces/new",
  staticData: stackedScreen,
  validateSearch: (search: Record<string, unknown>) => ({
    from: textParam(search.from),
    returnTo: textParam(search.returnTo),
  }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: ({ context, deps }) => loadShell(context, null, deps.from),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "NewSpacePending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/new-space"), "NewSpaceRoute"),
});

/** HU-E9-05: the members of a shared or direct space; `?invite=1` opens the invite sheet (N10). */
const membersRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "members",
  staticData: { ...stackedScreen, areas: ["members"] },
  validateSearch: (search: Record<string, unknown>) => ({ invite: textParam(search.invite) }),
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await sharedSpaces()).loadMembers({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "MembersPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/members"), "MembersRoute"),
});

/** HU-E9-07, ruling P176: a member's balance history, `?from=<date>` for another period. */
const historyRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "members/$memberId/history",
  staticData: { ...stackedScreen, areas: ["members"] },
  validateSearch: (search: Record<string, unknown>) => ({ from: textParam(search.from) }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await sharedSpaces()).loadHistory({ ...context, cause }, params.spaceId, params.memberId, deps.from),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "HistoryPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/members"), "HistoryRoute"),
});

/** HU-E9-07: balances and settle-up; `?settle=<member id>` opens the sheet with that member paying. */
const balancesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "balances",
  staticData: { areas: ["members"] },
  validateSearch: (search: Record<string, unknown>) => ({ settle: textParam(search.settle) }),
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await sharedSpaces()).loadBalances({ ...context, cause }, params.spaceId),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "BalancesPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/balances"), "BalancesRoute"),
});

/**
 * Ruling P157: the invitation and claim pages, open to anyone, signed in or not: in the public frame, but without its
 * redirect of a signed-in person, and each page reads the session it needs.
 */
const openRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_open",
  component: lazyRouteComponent(() => import("./routes/public-layout"), "PublicLayout"),
});

const invitationRoute = createRoute({
  getParentRoute: () => openRoute,
  path: "invitations/$token",
  staticData: { areas: ["invitation"] },
  loader: ({ context, route }) => loadAreas(context, route),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/invitation"), "InvitationRoute"),
});

const claimRoute = createRoute({
  getParentRoute: () => openRoute,
  path: "claims/$token",
  staticData: { areas: ["invitation"] },
  loader: ({ context, route }) => loadAreas(context, route),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/invitation"), "ClaimRoute"),
});

/** Issue #86, ruling P286: the link of a verification email, `?token=`, confirmed through the API. */
const verifyEmailRoute = createRoute({
  getParentRoute: () => openRoute,
  path: "verify-email",
  staticData: { areas: ["invitation"] },
  validateSearch: (search: Record<string, unknown>) => ({ token: textParam(search.token) ?? "" }),
  loader: ({ context, route }) => loadAreas(context, route),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/verify-email"), "VerifyEmailRoute"),
});

/** Issue #146, ruling P290: Lo que tienes que saber, linked from sign-up and from Ajustes, each its own way back. */
const trustRoute = createRoute({
  getParentRoute: () => openRoute,
  path: "trust",
  staticData: { areas: ["trust"] },
  validateSearch: (search: Record<string, unknown>) => ({
    next: textParam(search.next),
    invitation: textsParam(search.invitation),
    from: textParam(search.from),
  }),
  loader: ({ context, route }) => loadAreas(context, route),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/trust"), "TrustRoute"),
});

/** HU-E9-10, HU-E9-11: the Plan tab's own page and its views, each with `?period=` (P200). */
const planRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "home", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "PlanRoute"),
});

const linesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/lines",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "lines", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "LinesRoute"),
});

const groupsRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/groups",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "groups", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "GroupsRoute"),
});

const trendRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/trend",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "trend", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "TrendRoute"),
});

const fundRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/fund",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "fund", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "FundRoute"),
});

const matrixRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/members",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "members", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "MembersMatrixRoute"),
});

const calendarRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plan/calendar",
  staticData: { areas: ["plan"] },
  validateSearch: planSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanView({ ...context, cause }, params.spaceId, "calendar", deps),
    ),
  pendingComponent: planPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plan"), "CalendarRoute"),
});

/** Ruling P267 (U10, U4): Mi consumo, a stacked screen of the personal space opened from Inicio, with `?period=`. */
const myConsumptionRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "my-consumption",
  staticData: { ...stackedScreen, areas: ["plan"] },
  validateSearch: (search: Record<string, unknown>) => ({ period: textParam(search.period) }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadMyConsumption({ ...context, cause }, params.spaceId, deps),
    ),
  pendingComponent: lazyRouteComponent(() => import("./routes/pending"), "MyConsumptionPending"),
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/my-consumption"), "MyConsumptionRoute"),
});

/**
 * HU-E9-08: the planner of one plan, its capacities and its lines. Ruling P303 (owner, 2026-11-06: "que la barra
 * principal sea lo prioritario"): the planner and its contributions sheet keep the shell, its bottom bar the way out
 * that always works, as the Plan tab's own screens do; the line form stays a stacked screen with its Volver.
 */
const plannerRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plans/$planId",
  staticData: { areas: ["plan"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadPlanner({ ...context, cause }, params.spaceId, params.planId),
    ),
  pendingComponent: plannerPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plans"), "PlannerRoute"),
});

const capacitiesRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plans/$planId/capacities",
  staticData: { areas: ["plan"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadCapacities({ ...context, cause }, params.spaceId, params.planId),
    ),
  pendingComponent: plannerPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plans"), "CapacitiesRoute"),
});

const newLineRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plans/$planId/lines/new",
  staticData: { ...stackedScreen, areas: ["plan"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadLineEditor({ ...context, cause }, params.spaceId, params.planId),
    ),
  pendingComponent: plannerPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plans"), "NewLineRoute"),
});

const editLineRoute = createRoute({
  getParentRoute: () => spaceRoute,
  path: "plans/$planId/lines/$lineId",
  staticData: { ...stackedScreen, areas: ["plan"] },
  loader: async ({ context, params, cause, route }) =>
    withAreas(
      loadAreas(context, route),
      (await plans()).loadLineEditor({ ...context, cause }, params.spaceId, params.planId),
    ),
  pendingComponent: plannerPending,
  errorComponent: ScreenError,
  component: lazyRouteComponent(() => import("./routes/plans"), "EditLineRoute"),
});

export const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([signInRoute, signUpRoute]),
  openRoute.addChildren([invitationRoute, claimRoute, verifyEmailRoute, trustRoute]),
  indexRoute,
  settingsRoute,
  newSpaceRoute,
  spaceRoute.addChildren([
    spaceHomeRoute,
    transactionsRoute,
    recordRoute,
    pendingOccurrencesRoute,
    editRoute,
    recurrencesRoute,
    newRecurrenceRoute,
    recurrenceRoute,
    editRecurrenceRoute,
    accountsRoute,
    newAccountRoute,
    editAccountRoute,
    categoriesRoute,
    membersRoute,
    historyRoute,
    balancesRoute,
    planRoute,
    linesRoute,
    groupsRoute,
    trendRoute,
    fundRoute,
    matrixRoute,
    calendarRoute,
    myConsumptionRoute,
    plannerRoute,
    capacitiesRoute,
    newLineRoute,
    editLineRoute,
  ]),
]);
