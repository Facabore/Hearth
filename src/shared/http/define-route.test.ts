import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import { createRouteFactory } from "./define-route";
import type { Logger } from "./logger";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const logger: Logger = { info: vi.fn(), error: vi.fn() };
const defineRoute = createRouteFactory(() => ({
  sessionResolver: { resolve: async (h) => (h.get("authorization") === "Bearer ana" ? ana : null) },
  logger,
}));
const call = (handler: (r: Request) => Promise<Response>, init: RequestInit & { path?: string } = {}) =>
  handler(new Request(`http://localhost${init.path ?? "/api/v1/test"}`, init));

describe("defineRoute", () => {
  it.each([
    ["InsufficientRole", 403],
    ["InvalidAmount", 422],
    ["SpaceNotFound", 404],
    ["OutstandingBalance", 409],
    ["PeriodClosed", 409],
  ])("returns the domain error %s as problem+json %i with no translated text", async (code, status) => {
    const route = defineRoute({
      auth: "required",
      handler: async () => err(domainError(code, { secret: "x" })),
    });
    const response = await call(route, { headers: { authorization: "Bearer ana", "accept-language": "es" } });
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body.code).toBe(code);
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toMatch(/[áéíóúñ¿¡]|no encontrado|prohibido|secret/i);
  });

  it("shows the outstanding amount of OutstandingBalance, and only that detail (HU-E1-08)", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async () =>
        err(
          domainError("OutstandingBalance", {
            outstanding: { amount: "15000000", currency: "COP" },
            memberId: "m-1",
          }),
        ),
    });
    const body = await (await call(route)).json();
    expect(body).toMatchObject({
      status: 409,
      code: "OutstandingBalance",
      outstanding: { amount: "15000000", currency: "COP" },
    });
    expect(body).not.toHaveProperty("memberId");
  });

  it("rejects unauthenticated requests with 401 Unauthenticated before running the handler", async () => {
    const handler = vi.fn(async () => ok({ status: 200, body: {} }));
    const response = await call(defineRoute({ auth: "required", handler }));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("Unauthenticated");
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the resolved user to the handler", async () => {
    const route = defineRoute({
      auth: "required",
      handler: async ({ user }) => ok({ status: 200, body: user }),
    });
    expect(await (await call(route, { headers: { authorization: "Bearer ana" } })).json()).toEqual(ana);
  });

  it("serves public routes without credentials", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async ({ user }) => ok({ status: 200, body: { user } }),
    });
    expect(await (await call(route)).json()).toEqual({ user: null });
  });

  it("echoes a valid incoming X-Request-Id and replaces an invalid one", async () => {
    const route = defineRoute({ auth: "none", handler: async () => ok({ status: 204 }) });
    const echoed = await call(route, { headers: { "x-request-id": "abc-123" } });
    expect(echoed.headers.get("x-request-id")).toBe("abc-123");
    for (const bad of ["bad id with spaces", "x".repeat(129)]) {
      const replaced = (await call(route, { headers: { "x-request-id": bad } })).headers.get("x-request-id");
      expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns 422 ValidationFailed with paths for contract failures", async () => {
    const route = defineRoute({
      auth: "none",
      body: z.object({ amount: z.string(), split: z.object({ ratio: z.number() }) }),
      handler: async () => ok({ status: 201 }),
    });
    const response = await call(route, {
      method: "POST",
      body: JSON.stringify({ amount: 160000000, split: { ratio: "x" } }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("ValidationFailed");
    expect(body.errors.map((e: { path: string }) => e.path)).toEqual(["amount", "split.ratio"]);
  });

  it("names the fields of a domain ValidationFailed in errors[], and only of that code (issue 121)", async () => {
    const fail = (code: string, details: Record<string, unknown>) =>
      call(defineRoute({ auth: "none", handler: async () => err(domainError(code, details)) }));
    const named = await (
      await fail("ValidationFailed", {
        errors: [
          { path: "icon", message: "No style of its own", secret: "x" },
          { path: 7, message: "dropped" },
        ],
      })
    ).json();
    expect(named.errors).toEqual([{ path: "icon", message: "No style of its own" }]);
    expect((await (await fail("ValidationFailed", { field: "style" })).json()).errors).toBeUndefined();
    expect(
      (await (await fail("InvalidAmount", { errors: [{ path: "a", message: "b" }] })).json()).errors,
    ).toBe(undefined);
  });

  it("returns 422 ValidationFailed for malformed JSON instead of a 500", async () => {
    const route = defineRoute({ auth: "none", body: z.object({}), handler: async () => ok({ status: 201 }) });
    const response = await call(route, { method: "POST", body: '{"amount": ' });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("ValidationFailed");
  });

  it("validates the query string", async () => {
    const route = defineRoute({
      auth: "none",
      query: z.object({ limit: z.coerce.number().int().max(200) }),
      handler: async ({ query }) => ok({ status: 200, body: query }),
    });
    expect((await call(route, { path: "/api/v1/test?limit=201" })).status).toBe(422);
    expect(await (await call(route, { path: "/api/v1/test?limit=5" })).json()).toEqual({ limit: 5 });
  });

  it("passes route params through", async () => {
    const route = defineRoute<undefined, undefined, { spaceId: string }>({
      auth: "none",
      handler: async ({ params }) => ok({ status: 200, body: params }),
    });
    const response = await route(new Request("http://localhost/x"), {
      params: Promise.resolve({ spaceId: "s1" }),
    });
    expect(await response.json()).toEqual({ spaceId: "s1" });
  });

  it("logs unexpected errors and returns 500 InternalError without leaking the message", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async () => {
        throw new Error("db down");
      },
    });
    const response = await call(route);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).code).toBe("InternalError");
    expect(text).not.toContain("db down");
    expect(logger.error).toHaveBeenCalledWith(
      "unhandled_route_error",
      expect.objectContaining({
        error: { name: "Error", message: "db down" },
        requestId: response.headers.get("x-request-id"),
      }),
    );
  });

  it("logs a database failure as name, first message line, SQLSTATE and constraint, never its SQL parameters", async () => {
    const error = vi.fn();
    const logged = createRouteFactory(() => ({
      sessionResolver: { resolve: async () => null },
      logger: { info: vi.fn(), error },
    }));
    const failure = Object.assign(
      new Error(
        'Failed query: insert into "space_members" ("contact_email") values ($1) \nparams: secret-hash,ana@example.com',
        { cause: { code: "23505", constraint: "x_uq", detail: "Key (contact_email)=(ana@example.com)" } },
      ),
      { name: "DrizzleQueryError" },
    );
    const response = await call(
      logged({
        auth: "none",
        handler: async () => {
          throw failure;
        },
      }),
    );
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
    const record = JSON.stringify(error.mock.calls[0]);
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      error: {
        name: "DrizzleQueryError",
        message: 'Failed query: insert into "space_members" ("contact_email") values ($1)',
        code: "23505",
        constraint: "x_uq",
      },
    });
    expect(record).not.toContain("secret-hash");
    expect(record).not.toContain("ana@example.com");
    expect(record).not.toContain("params");
  });

  it("removes a params tail from a single-line message and tolerates thrown non-errors", async () => {
    const error = vi.fn();
    const logged = createRouteFactory(() => ({
      sessionResolver: { resolve: async () => null },
      logger: { info: vi.fn(), error },
    }));
    for (const thrown of [new Error("Failed query: select 1 params: secret-hash"), "plain string"]) {
      await call(
        logged({
          auth: "none",
          handler: async () => {
            throw thrown;
          },
        }),
      );
    }
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-hash");
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      error: { name: "Error", message: "Failed query: select 1" },
    });
    expect(error.mock.calls[1]?.[1]).toMatchObject({ error: { name: "NonErrorThrown" } });
  });

  it("logs Err results that map to a 5xx with their details, but not client errors", async () => {
    const error = vi.fn();
    const logged = createRouteFactory(() => ({
      sessionResolver: { resolve: async () => null },
      logger: { info: vi.fn(), error },
    }));
    const internal = await call(
      logged({ auth: "none", handler: async () => err(domainError("InternalError", { cause: "Boom" })) }),
    );
    expect(internal.status).toBe(500);
    expect(JSON.stringify(await internal.json())).not.toContain("Boom");
    expect(error).toHaveBeenCalledWith("route_error_result", {
      requestId: internal.headers.get("x-request-id"),
      code: "InternalError",
      details: { cause: "Boom" },
    });
    error.mockClear();
    await call(logged({ auth: "none", handler: async () => err(domainError("SpaceNotFound")) }));
    expect(error).not.toHaveBeenCalled();
  });

  it("returns 500 when the session resolver fails", async () => {
    const failing = createRouteFactory(() => ({
      sessionResolver: { resolve: () => Promise.reject(new Error("store down")) },
      logger,
    }));
    const response = await call(failing({ auth: "required", handler: async () => ok({ status: 200 }) }));
    expect(response.status).toBe(500);
  });

  it("returns a logged problem+json 500 when the dependencies cannot be built", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const broken = createRouteFactory(() => {
      throw new Error("missing DATABASE_URL");
    });
    const response = await call(broken({ auth: "none", handler: async () => ok({ status: 200 }) }));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect((await response.json()).requestId).toBe(response.headers.get("x-request-id"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("missing DATABASE_URL"));
    log.mockRestore();
  });

  it("serializes bigint values as strings and appends repeated headers", async () => {
    const route = defineRoute({
      auth: "none",
      handler: async () =>
        ok({
          status: 200,
          body: { minor: 160000000n },
          headers: [
            ["set-cookie", "a=1"],
            ["set-cookie", "b=2"],
          ],
        }),
    });
    const response = await call(route);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ minor: "160000000" });
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  it("lets a before hook wrap the handler", async () => {
    const route = defineRoute({
      auth: "none",
      before: async (_ctx, next) => {
        const result = await next();
        return result.ok ? ok({ ...result.value, headers: [["x-wrapped", "yes"]] }) : result;
      },
      handler: async () => ok({ status: 200, body: {} }),
    });
    expect((await call(route)).headers.get("x-wrapped")).toBe("yes");
  });
});
