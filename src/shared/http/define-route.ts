import type { ZodType } from "zod";
import type { AuthUser, Result } from "@/shared/kernel";
import { failureOf } from "@/shared/kernel/failure";
import { jsonLogger, type Logger } from "./logger";
import { nulFieldErrors } from "./nul-guard";
import {
  problemResponse,
  publicDetailsOf,
  publicFieldErrorsOf,
  statusForCode,
  type ProblemFieldError,
} from "./problem";
import { requestIdFrom } from "./request-id";
import type { SessionResolver } from "./session-resolver";

export type HttpSuccess = {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: ReadonlyArray<readonly [string, string]>;
};

export interface RouteDeps {
  readonly sessionResolver: SessionResolver;
  readonly logger: Logger;
}

export interface RouteContext<B, Q, P> {
  readonly request: Request;
  readonly requestId: string;
  readonly user: AuthUser | null;
  readonly body: B;
  readonly query: Q;
  readonly params: P;
}

export interface RouteSpec<B, Q, P> {
  readonly auth: "required" | "none";
  readonly body?: ZodType<B>;
  readonly query?: ZodType<Q>;
  /** Wraps the handler, e.g. idempotency (Task 9). */
  readonly before?: (
    ctx: RouteContext<B, Q, P>,
    next: () => Promise<Result<HttpSuccess>>,
  ) => Promise<Result<HttpSuccess>>;
  readonly handler: (ctx: RouteContext<B, Q, P>) => Promise<Result<HttpSuccess>>;
}

const toFieldErrors = (
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): ProblemFieldError[] =>
  issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));

const bigintAsString = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

/**
 * What an unhandled error may write to the log (#190): `failureOf`'s name, SQLSTATE and constraint, as every job logs
 * a failure. Never the message: Drizzle puts the bound parameters there, and a driver message can quote a value. The
 * one exception is the config loader's `EnvError`, written to be logged: it names the variables, never their values.
 */
const summaryOf = (error: unknown): Record<string, string> => {
  const { error: name, ...database } = failureOf(error);
  return {
    name,
    ...(error instanceof Error && name === "EnvError" ? { message: error.message } : {}),
    ...database,
  };
};

/**
 * HU-E8-02: the stack frames of an unhandled error ("at …"). The stack starts with the message, which may span lines
 * and carry a query's parameters (P252), so its lines are dropped before the frames are kept, even one that reads
 * like a frame (#190). The frames are what follows the message, whatever name the header carries (one renamed after
 * its stack was read keeps "Error"); a stack that does not hold the message (one a library rewrote) logs none.
 */
const framesOf = (error: unknown): string[] => {
  if (!(error instanceof Error) || !error.stack) return [];
  const end = error.stack.indexOf(error.message);
  if (end < 0) return [];
  return error.stack
    .slice(end + error.message.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "));
};

/** A path segment as Next.js passes it to the params; a malformed percent-escape is left as it is. */
const decodedSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * HU-E8-02: the request's path with each route parameter written as its name ("/api/v1/invitations/[token]"), so the
 * access log groups by route and never writes an id or a token from the path. A catch-all parameter's values each
 * become its name. The template is found by value: a static segment equal to a parameter's value is written as that
 * name too, which only blurs the route, never leaks. Before the parameters are known, the path is not logged at all.
 */
const routeOf = (request: Request, params: Record<string, unknown> | null): string => {
  if (params === null) return "unknown";
  const names = new Map(
    Object.entries(params).flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).flatMap((one) =>
        typeof one === "string" ? [[one, name] as const] : [],
      ),
    ),
  );
  return new URL(request.url).pathname
    .split("/")
    .map((segment) => {
      const name = names.get(decodedSegment(segment));
      return name === undefined ? segment : `[${name}]`;
    })
    .join("/");
};

/**
 * Builds Next.js route handlers: resolves the user, validates query and body with Zod,
 * maps `Err` results to problem+json and turns unexpected throws into a logged 500. Every request ends with one
 * access log line: request id, method, route, status and duration (HU-E8-02).
 */
export const createRouteFactory =
  (getDeps: () => RouteDeps) =>
  <B = undefined, Q = undefined, P extends Record<string, string> = Record<string, string>>(
    spec: RouteSpec<B, Q, P>,
  ) =>
  async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const requestId = requestIdFrom(request);
    const started = performance.now();
    // Until the dependencies exist, failures are logged with the default JSON logger.
    let logger: Logger = jsonLogger;
    let params: P | null = null;
    const response = await respond();
    // Logging never changes the answer: a failure to write the access line is dropped.
    try {
      logger.info("request", {
        requestId,
        method: request.method,
        route: routeOf(request, params),
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      });
    } catch {
      // The response stands.
    }
    return response;

    async function respond(): Promise<Response> {
      try {
        // The parameters first, so the access log can name the route of any answer, a refused one included.
        params = ((await context?.params) ?? {}) as P;
        const deps = getDeps();
        logger = deps.logger;
        const user = spec.auth === "none" ? null : await deps.sessionResolver.resolve(request.headers);
        if (spec.auth === "required" && !user) return problemResponse("Unauthenticated", requestId);

        let query = undefined as Q;
        if (spec.query) {
          const rawQuery = Object.fromEntries(new URL(request.url).searchParams);
          const nul = nulFieldErrors(rawQuery);
          if (nul.length > 0) return problemResponse("ValidationFailed", requestId, nul);
          const parsed = spec.query.safeParse(rawQuery);
          if (!parsed.success)
            return problemResponse("ValidationFailed", requestId, toFieldErrors(parsed.error.issues));
          query = parsed.data;
        }

        let body = undefined as B;
        if (spec.body) {
          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return problemResponse("ValidationFailed", requestId, [
              { path: "", message: "Body must be valid JSON" },
            ]);
          }
          // Issue 118: PostgreSQL text refuses NUL, so it is refused here for every field of every route.
          const nul = nulFieldErrors(raw);
          if (nul.length > 0) return problemResponse("ValidationFailed", requestId, nul);
          const parsed = spec.body.safeParse(raw);
          if (!parsed.success)
            return problemResponse("ValidationFailed", requestId, toFieldErrors(parsed.error.issues));
          body = parsed.data;
        }

        const ctx: RouteContext<B, Q, P> = { request, requestId, user, body, query, params };
        const result = spec.before
          ? await spec.before(ctx, () => spec.handler(ctx))
          : await spec.handler(ctx);
        if (!result.ok) {
          // Server-side failures reach clients as a bare code; their details go to the log only.
          if (statusForCode(result.error.code) >= 500) {
            logger.error("route_error_result", {
              requestId,
              code: result.error.code,
              details: result.error.details,
            });
          }
          const { code, details } = result.error;
          return problemResponse(
            code,
            requestId,
            publicFieldErrorsOf(code, details),
            publicDetailsOf(code, details),
          );
        }

        const headers = new Headers({ "x-request-id": requestId });
        for (const [name, value] of result.value.headers ?? []) headers.append(name, value);
        if (result.value.body === undefined)
          return new Response(null, { status: result.value.status, headers });
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(result.value.body, bigintAsString), {
          status: result.value.status,
          headers,
        });
      } catch (error) {
        logger.error("unhandled_route_error", { requestId, error: summaryOf(error), stack: framesOf(error) });
        return problemResponse("InternalError", requestId);
      }
    }
  };
