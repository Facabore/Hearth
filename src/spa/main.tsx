import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/(web)/globals.css";
import { setAppBase } from "@/shared/ui/navigation/history";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { meQuery } from "./queries";
import { BASE_PATH } from "./router";

// Volver, the trail and the detail sheet read the browser's address as the app's own paths (ADR 0006).
setAppBase(BASE_PATH);

const { Spa, queryClient, apis } = createSpa();
// The profile and the likely catalog load together with the app's first chunks, not after them.
void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
