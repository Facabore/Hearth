import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import {
  buildContainer,
  setContainerForTests,
  type Container,
  type ContainerOptions,
} from "@/composition/container";

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
    options,
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
