import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { earlyResult, takeEarlyReads } from "./early";
import { meQuery, spacesQuery, spacesFrom } from "./queries";
import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import { meFrom } from "@/shared/ui/api/readers";
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
// The profile and the likely catalog load together with the app's first chunks, not after them. The profile, and the
// spaces of a signed-in person, were already asked for by the HTML (`early.ts`): the guard and the shell join those
// reads instead of starting their own.
const early = takeEarlyReads();
if (early) {
  void queryClient.prefetchQuery({
    ...meQuery(apis.sessionApi),
    queryFn: async () => meFrom(await earlyResult<MeDto>(early.me)),
  });
  // A profile read that failed on the network is the guard's to read again; no spaces are read for it here.
  void early.me.then(
    (answer) => {
      if (!answer.ok) return;
      void queryClient.prefetchQuery({
        ...spacesQuery(apis.api),
        queryFn: async () => {
          const spaces = await early.spaces;
          return spacesFrom(
            spaces
              ? await earlyResult<{ items: SpaceDto[] }>(Promise.resolve(spaces))
              : await apis.api.GET("/api/v1/spaces"),
          );
        },
      });
    },
    () => undefined,
  );
} else void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
