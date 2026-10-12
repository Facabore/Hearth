import { createHash } from "node:crypto";
import { domainError, err, ok, type Result, type TransactionManager } from "@/shared/kernel";
import type { HttpSuccess, RouteContext } from "./define-route";
import { toJsonSafe } from "./json";

export interface IdempotencyScope {
  readonly userId: string;
  readonly route: string;
  readonly key: string;
}

export interface IdempotencyStore {
  /**
   * Claims (userId, route, key) inside the current transaction. Returns null when this call
   * created the claim; otherwise waits for any in-flight holder and returns its record.
   */
  claim(
    scope: IdempotencyScope,
    requestHash: string,
  ): Promise<{ requestHash: string; response: HttpSuccess | null } | null>;
  complete(scope: IdempotencyScope, requestHash: string, response: HttpSuccess): Promise<void>;
}

export interface IdempotencyDeps {
  readonly store: IdempotencyStore;
  readonly tm: TransactionManager;
}

const KEY = /^[A-Za-z0-9_-]{1,255}$/;

const hashOf = (route: string, body: unknown): string =>
  createHash("sha256")
    .update(`${route}\n${JSON.stringify(toJsonSafe(body) ?? null)}`)
    .digest("hex");

/**
 * `before` hook for `defineRoute` on POSTs that create money records (spec section 7).
 * The claim, the handler and the stored response share one transaction, so a failed
 * request leaves no claim behind and a concurrent duplicate waits for the first to finish.
 */
export const idempotent =
  (deps: IdempotencyDeps) =>
  async <B, Q, P>(
    ctx: RouteContext<B, Q, P>,
    next: () => Promise<Result<HttpSuccess>>,
  ): Promise<Result<HttpSuccess>> => {
    const key = ctx.request.headers.get("idempotency-key");
    if (key === null || ctx.user === null) return next();
    if (!KEY.test(key)) return err(domainError("InvalidIdempotencyKey"));

    const scope = {
      userId: ctx.user.id,
      route: `${ctx.request.method} ${new URL(ctx.request.url).pathname}`,
      key,
    };
    const requestHash = hashOf(scope.route, ctx.body);
    return deps.tm.run(async () => {
      const existing = await deps.store.claim(scope, requestHash);
      if (existing) {
        if (existing.requestHash !== requestHash || existing.response === null) {
          return err(domainError("IdempotencyKeyConflict"));
        }
        return ok(existing.response);
      }
      const result = await next();
      if (result.ok) await deps.store.complete(scope, requestHash, result.value);
      return result;
    });
  };
