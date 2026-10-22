import type { ZodType } from "zod";
import type { AuthUser, Result } from "@/shared/kernel";
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

const firstLineOf = (message: string): string =>
  (message.split("\n")[0] ?? "").split(/\bparams:/)[0]?.trim() ?? "";

/**
 * What an unhandled error may write to the log: its name, the first line of its message without any
 * `params:` tail, and the SQLSTATE and constraint of a database cause. Drizzle puts the bound SQL
 * parameters (token hashes, contact emails) in the message, so they are never logged.
 */
const summaryOf = (error: unknown): Record<string, string> => {
  if (!(error instanceof Error)) return { name: "NonErrorThrown", message: firstLineOf(String(error)) };
  const { code, constraint } = (error.cause ?? {}) as { code?: unknown; constraint?: unknown };
  return {
    name: error.name,
    message: firstLineOf(error.message),
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
};

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

      const params = ((await context?.params) ?? {}) as P;
      const ctx: RouteContext<B, Q, P> = { request, requestId, user, body, query, params };
      const result = spec.before ? await spec.before(ctx, () => spec.handler(ctx)) : await spec.handler(ctx);
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
      logger.error("unhandled_route_error", { requestId, error: summaryOf(error) });
      return problemResponse("InternalError", requestId);
    }
  };
