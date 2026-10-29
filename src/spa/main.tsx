import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { meQuery } from "./queries";
import { appWrites } from "./writes-catalog";

// Volver's trail (history.ts) records from the moment its small chunk arrives, which is well before the first screen
// can be tapped; started on render, React's reveal of a lazy component left the first taps unrecorded.
void import("@/shared/ui/navigation/navigation-tracker").then(({ trackNavigation }) => trackNavigation());

const { Spa, router, queryClient, apis } = createSpa();
// The write plans load once the first screen has resolved, never beside it: over HTTP/1.1 their chunks queued ahead
// of the screen's own and of its reads. The first save still waits on no download; a chunk that cannot load (offline,
// or gone after a release) is no error, since a write without its plans is still sent (`writes.ts`).
const settled = router.subscribe("onResolved", () => {
  settled();
  void appWrites().catch(() => undefined);
});
// The profile and the likely catalog load together with the app's first chunks, not after them.
void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
