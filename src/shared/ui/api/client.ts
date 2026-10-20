import createClient, { type Client } from "openapi-fetch";
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

/** In the browser: same origin, the session cookie travels by itself. Call it from client code only. */
export const browserApi = (): Api => createApi({ baseUrl: globalThis.location?.origin ?? "" });
