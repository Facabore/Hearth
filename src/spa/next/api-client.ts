// The real module by its path: this file stands in for `@/shared/ui/api/client` in the SPA (vite.spa.config.ts).
import { browserApi as pageApi, type Api, type BrowserLocation } from "../../shared/ui/api/client";

export * from "../../shared/ui/api/client";

let appApi: Api | null = null;

/** The app's own client of /api/v1 (`createSpa`): its writes run through the query cache's plans (ADR 0006). */
export const registerBrowserApi = (api: Api | null): void => {
  appApi = api;
};

/**
 * The components' default client, `browserApi()`, is the app's own inside the SPA, so a component nested deep in a
 * screen writes through the same plans as the screen, and a session that ends mid-use returns to the app's own sign-in
 * (P151), with no client handed down through every component. A call that names its location keeps its own client.
 */
export const browserApi = (where?: BrowserLocation): Api =>
  where === undefined && appApi !== null ? appApi : pageApi(where);
