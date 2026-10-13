import { createRouteFactory, idempotent, type HttpSuccess, type RouteContext } from "@/shared/http";
import type { Result } from "@/shared/kernel";
import { getContainer } from "./container";

/** Route handlers bound to the process container. */
export const defineRoute = createRouteFactory(getContainer);

/**
 * `before` hook for POSTs that create transactions (spec section 7). The container is resolved per
 * request, so tests can install theirs after the route module was imported.
 */
export const withIdempotency = <B, Q, P>(
  ctx: RouteContext<B, Q, P>,
  next: () => Promise<Result<HttpSuccess>>,
): Promise<Result<HttpSuccess>> => idempotent(getContainer().idempotency)(ctx, next);
