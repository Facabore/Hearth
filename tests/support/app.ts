import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import {
  buildContainer,
  setContainerForTests,
  type Container,
  type ContainerOptions,
} from "@/composition/container";

// Generous by default: suites register many users from one address. Throttling tests pass their own limits.
const RELAXED_LIMITS = { signInPerEmail: 1000, signInPerIp: 1000, signUpPerIp: 1000 };

/** Builds the real container against the test database and installs it for the route handlers. */
export const startTestApp = (options: ContainerOptions = {}): Container => {
  const container = buildContainer(
    {
      DATABASE_URL: inject("databaseUrl"),
      BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
      BETTER_AUTH_URL: "http://localhost:3000",
      APP_TIMEZONE: "America/Bogota",
      LOG_LEVEL: "error",
    },
    { authLimits: RELAXED_LIMITS, ...options },
  );
  setContainerForTests(container);
  return container;
};

export const apiRequest = (
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** Turns Set-Cookie headers into a Cookie request header. */
export const cookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

export const uniqueEmail = (name: string): string => `${name}-${randomUUID()}@example.com`;

export interface TestUser {
  readonly cookie: string;
  readonly userId: string;
  readonly spaceId: string;
  readonly email: string;
}

/** Signs a user up over HTTP (a fresh email unless given); returns their session cookie, personal space id and email. */
export const registerUser = async (
  name = "Ana",
  email = uniqueEmail(name.toLowerCase()),
): Promise<TestUser> => {
  const created = await signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", { body: { name, email, password: "123456789012" } }),
  );
  if (created.status !== 201) throw new Error(`sign-up failed with status ${created.status}`);
  const cookie = cookieHeader(created);
  const { user } = (await created.json()) as { user: { id: string } };
  const spaces = await listSpaces(apiRequest("GET", "/api/v1/spaces", { headers: { cookie } }));
  const { items } = (await spaces.json()) as { items: { id: string }[] };
  return { cookie, userId: user.id, spaceId: items[0]!.id, email };
};

export const routeParams = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

/** Calls a route handler in-process as `user`, with path params, JSON body and extra headers. */
export const call = (
  handler: RouteHandler,
  method: string,
  path: string,
  options: {
    user?: TestUser;
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> =>
  handler(
    apiRequest(method, path, {
      body: options.body,
      headers: { ...(options.user ? { cookie: options.user.cookie } : {}), ...options.headers },
    }),
    routeParams(options.params ?? {}),
  );

/** Status and problem code of an error response: `expect(await problemOf(response)).toEqual([404, "SpaceNotFound"])`. */
export const problemOf = async (response: Response): Promise<[number, string]> => [
  response.status,
  ((await response.json()) as { code: string }).code,
];
