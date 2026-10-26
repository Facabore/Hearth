import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/**
 * HU-E8-02: liveness plus the database. 200 `{ status: "ok", db: "ok" }` while PostgreSQL answers, 503
 * `{ status: "unavailable", db: "unreachable" }` when it does not, so the Docker health check fails and Caddy stops
 * routing to the container.
 */
export const GET = defineRoute({
  auth: "none",
  handler: async () =>
    (await getContainer().databaseReachable())
      ? ok({ status: 200, body: { status: "ok", db: "ok" } })
      : ok({ status: 503, body: { status: "unavailable", db: "unreachable" } }),
});
