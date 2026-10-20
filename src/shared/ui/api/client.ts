import createClient, { type Client, type Middleware } from "openapi-fetch";
import { expiredSignInUrl } from "../navigation/auth-redirect";
import type { paths } from "./schema";

/** Ruling P117: the one client of /api/v1, typed by the generated `paths`. */
export type Api = Client<paths>;

export const createApi = (options: {
  readonly baseUrl: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: (request: Request) => Promise<Response>;
}): Api =>
  createClient<paths>({
    baseUrl: options.baseUrl,
    headers: options.headers,
    fetch: options.fetch,
    cache: "no-store",
  });

/** The part of `window.location` the browser client reads and moves. */
export interface BrowserLocation {
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  assign(url: string): void;
}

const AUTH_PREFIX = "/api/v1/auth/";

/**
 * Ruling P151: a 401 from any call outside `/api/v1/auth/*` means the session ended while the page was open, so the
 * browser goes to the sign-in screen and comes back to this page. The auth calls answer their own 401 (wrong
 * credentials) to the form. A half-filled form is lost; that is accepted for M6a.
 */
const sessionExpiry = (where: BrowserLocation): Middleware => ({
  onResponse({ request, response }) {
    if (response.status === 401 && !new URL(request.url).pathname.startsWith(AUTH_PREFIX)) {
      where.assign(expiredSignInUrl(where));
    }
  },
});

/** In the browser: same origin, the session cookie travels by itself. Call it from client code only. */
export const browserApi = (where: BrowserLocation = globalThis.location): Api => {
  const api = createApi({ baseUrl: where?.origin ?? "" });
  if (where) api.use(sessionExpiry(where));
  return api;
};
