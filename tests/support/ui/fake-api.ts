import { createApi, type Api } from "@/shared/ui/api/client";

export type FakeHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly names: readonly string[];
  readonly handler: FakeHandler;
}

const routeOf = (key: string, handler: FakeHandler): Route => {
  const [method, template] = key.split(" ") as [string, string];
  const names: string[] = [];
  const source = template
    .split("/")
    .map((segment) => {
      const name = /^\{(.+)\}$/.exec(segment)?.[1];
      if (name === undefined) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(name);
      return "([^/]+)";
    })
    .join("/");
  return { method, pattern: new RegExp(`^${source}$`), names, handler };
};

/** A typed client whose calls reach the handlers of `routes` ("<METHOD> <path template>"); every request is kept. */
export const fakeApi = (routes: Record<string, FakeHandler>): { api: Api; requests: Request[] } => {
  const table = Object.entries(routes).map(([key, handler]) => routeOf(key, handler));
  const requests: Request[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    requests.push(request);
    const { pathname } = new URL(request.url);
    for (const route of table) {
      const match = route.method === request.method ? route.pattern.exec(pathname) : null;
      if (!match) continue;
      const params = Object.fromEntries(
        route.names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)]),
      );
      return route.handler(request, params);
    }
    throw new Error(`No fake route for ${request.method} ${pathname}`);
  };
  return { api: createApi({ baseUrl: "http://hearth.test", fetch }), requests };
};

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-test" },
  });

export const problemResponse = (
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response =>
  new Response(
    JSON.stringify({
      type: `urn:hearth:problem:${code}`,
      title: "",
      status,
      code,
      requestId: "req-test",
      ...extra,
    }),
    { status, headers: { "content-type": "application/problem+json", "x-request-id": "req-test" } },
  );
