import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterSheets, enableSheetHistory } from "@/shared/ui/navigation/sheet-gate";
import "./globals.css";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { seedEarlyReads, takeEarlyReads } from "./early";
import { meQuery } from "./queries";
import { appWrites } from "./writes-catalog";

// Volver's trail (history.ts) records from the moment its small chunk arrives, which is well before the first screen
// can be tapped; started on render, React's reveal of a lazy component left the first taps unrecorded.
void import("@/shared/ui/navigation/navigation-tracker").then(({ trackNavigation }) => trackNavigation());

// Ruling P307: an open sheet takes an entry of the browser's history, so Back closes it; a navigation from a sheet
// first gives those entries back, so the next screen never stacks on them.
enableSheetHistory();
const { Spa, router, queryClient, apis } = createSpa();
const { push, replace } = router.history;
router.history.push = (...args) => afterSheets(() => push(...args));
router.history.replace = (...args) => afterSheets(() => replace(...args));
// Going back (a form leaving for the screen it came from, P189) also starts below the sheets open over it.
const { back, go } = router.history;
router.history.back = (...args) => afterSheets(() => back(...args));
router.history.go = (...args) => afterSheets(() => go(...args));
// The write plans load once the first screen has resolved, never beside it: over HTTP/1.1 their chunks queued ahead
// of the screen's own and of its reads. The first save still waits on no download; a chunk that cannot load (offline,
// or gone after a release) is no error, since a write without its plans is still sent (`writes.ts`).
const settled = router.subscribe("onResolved", () => {
  settled();
  void appWrites().catch(() => undefined);
});
// The profile and the likely catalog load together with the app's first chunks, not after them. The profile, and the
// spaces of a signed-in person, were already asked for by the HTML: the guard and the shell join those reads.
const early = takeEarlyReads();
if (early) seedEarlyReads(queryClient, apis, early);
else void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
