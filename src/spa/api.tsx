import { createContext, useContext, type ReactNode } from "react";
import { browserApi, createApi, type Api, type BrowserLocation } from "@/shared/ui/api/client";

/**
 * The SPA's two clients of /api/v1 (ADR 0006), same origin with the cookie session:
 * - `api` for every screen: a 401 means the session ended while the app was open, so it goes to the sign-in screen
 *   and back (ruling P151), inside the app;
 * - `sessionApi` for the profile read of the guards and the intl provider only: there a 401 is simply "signed out".
 */
export interface SpaApis {
  readonly api: Api;
  readonly sessionApi: Api;
}

/** `where` is the app's own location (the router's) and navigation, as `browserApi` reads it. */
export const spaApis = (where: BrowserLocation): SpaApis => ({
  api: browserApi(where),
  sessionApi: createApi({ baseUrl: where.origin }),
});

const ApisContext = createContext<SpaApis | null>(null);

export function ApisProvider({ apis, children }: { readonly apis: SpaApis; readonly children: ReactNode }) {
  return <ApisContext value={apis}>{children}</ApisContext>;
}

export const useApis = (): SpaApis => {
  const apis = useContext(ApisContext);
  if (!apis) throw new Error("useApis needs an ApisProvider");
  return apis;
};
