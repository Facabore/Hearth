import type { ZodType } from "zod";
import type { AuthUser, Result } from "@/shared/kernel";
import { jsonLogger, type Logger } from "./logger";
import { problemResponse, type ProblemFieldError } from "./problem";
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
 * Builds Next.js route handlers: resolves the user, validates query and body with Zod,
 * maps `Err` results to problem+json and turns unexpected throws into a logged 500.
 */
export const createRouteFactory =
  (getDeps: () => RouteDeps) =>
  <B = undefined, Q = undefined, P extends Record<string, string> = Record<string, string>>(
    spec: RouteSpec<B, Q, P>,
  ) =>
  async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const requestId = requestIdFrom(request);
    // Until the dependencies exist, failures are logged with the default JSON logger.
    let logger: Logger = jsonLogger;
    try {
      const deps = getDeps();
      logger = deps.logger;
      const user = spec.auth === "none" ? null : await deps.sessionResolver.resolve(request.headers);
      if (spec.auth === "required" && !user) return problemResponse("Unauthenticated", requestId);

      let query = undefined as Q;
      if (spec.query) {
        const parsed = spec.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
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
        const parsed = spec.body.safeParse(raw);
        if (!parsed.success)
          return problemResponse("ValidationFailed", requestId, toFieldErrors(parsed.error.issues));
        body = parsed.data;
      }

      const params = ((await context?.params) ?? {}) as P;
      const ctx: RouteContext<B, Q, P> = { request, requestId, user, body, query, params };
      const result = spec.before ? await spec.before(ctx, () => spec.handler(ctx)) : await spec.handler(ctx);
      if (!result.ok) return problemResponse(result.error.code, requestId);

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
      logger.error("unhandled_route_error", { requestId, error: String(error) });
      return problemResponse("InternalError", requestId);
    }
  };
