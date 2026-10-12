import { and, eq, lt, sql } from "drizzle-orm";
import type { HttpSuccess } from "@/shared/http/define-route";
import type { IdempotencyScope, IdempotencyStore } from "@/shared/http/idempotency";
import { toJsonSafe } from "@/shared/http/json";
import type { DrizzleTransactionManager } from "./db/drizzle-transaction-manager";
import { idempotencyKeys } from "./idempotency.schema";

const byScope = (s: IdempotencyScope) =>
  and(
    eq(idempotencyKeys.userId, s.userId),
    eq(idempotencyKeys.route, s.route),
    eq(idempotencyKeys.key, s.key),
  );

/** Keys live 24 hours (spec section 7); an expired key is removed before it can be claimed again. */
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async claim(scope: IdempotencyScope, requestHash: string) {
    const db = this.tm.executor();
    await db
      .delete(idempotencyKeys)
      .where(and(byScope(scope), lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`)));
    // A concurrent uncommitted claim makes this INSERT wait until that transaction ends.
    const inserted = await db
      .insert(idempotencyKeys)
      .values({ ...scope, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length > 0) return null;
    const [row] = await db.select().from(idempotencyKeys).where(byScope(scope)).for("update");
    if (!row) return null;
    return {
      requestHash: row.requestHash,
      response:
        row.responseStatus === null
          ? null
          : {
              status: row.responseStatus,
              body: row.responseBody ?? undefined,
              headers: row.responseHeaders ?? [],
            },
    };
  }

  async complete(scope: IdempotencyScope, requestHash: string, response: HttpSuccess): Promise<void> {
    const values = {
      responseStatus: response.status,
      responseBody: toJsonSafe(response.body) ?? null,
      responseHeaders: (response.headers ?? []).map(([name, value]) => [name, value] as [string, string]),
    };
    await this.tm
      .executor()
      .insert(idempotencyKeys)
      .values({ ...scope, requestHash, ...values })
      .onConflictDoUpdate({
        target: [idempotencyKeys.userId, idempotencyKeys.route, idempotencyKeys.key],
        set: values,
      });
  }
}
