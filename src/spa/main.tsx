import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/(web)/globals.css";
import { createSpa } from "./app";
import { catalogQuery, visitorLocale } from "./i18n";
import { meQuery } from "./queries";

const { Spa, queryClient, apis } = createSpa();
// The profile and the likely catalog load together with the app's first chunks, not after them.
void queryClient.prefetchQuery(meQuery(apis.sessionApi));
void queryClient.prefetchQuery(catalogQuery(visitorLocale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Spa />
  </StrictMode>,
);
