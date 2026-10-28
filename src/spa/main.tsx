import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { meQuery } from "./queries";

// Volver's trail (history.ts) records from the moment its small chunk arrives, which is well before the first screen
// can be tapped; started on render, React's reveal of a lazy component left the first taps unrecorded.
void import("@/shared/ui/navigation/navigation-tracker").then(({ trackNavigation }) => trackNavigation());

const { Spa, queryClient, apis } = createSpa();
// The profile and the likely catalog load together with the app's first chunks, not after them.
void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
