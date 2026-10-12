import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { bigint, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MoneySchema } from "@/shared/http/contracts";
import { createRouteFactory, jsonLogger } from "@/shared/http";
import { etagOf, ifMatchVersion } from "@/shared/http/etag";
import { idempotent } from "@/shared/http/idempotency";
import { PaginationQuerySchema, decodeCursor, toPage } from "@/shared/http/pagination";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import { testDatabase } from "../../../tests/support/database";
import { DrizzleTransactionManager } from "./db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "./drizzle-idempotency-store";

const probe = pgTable("http_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  version: integer("version").notNull().default(1),
});
const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const juan: AuthUser = { ...ana, id: "u-juan", name: "Juan", email: "juan@example.com" };
const defineRoute = createRouteFactory(() => ({
  sessionResolver: { resolve: async (h) => (h.get("x-as") === "juan" ? juan : ana) },
  logger: jsonLogger,
}));

const create = defineRoute({
  auth: "required",
  body: z.object({ amount: MoneySchema }),
  before: idempotent({ tm, store: new DrizzleIdempotencyStore(tm) }),
  handler: async ({ body, user }) =>
    tm.run(async () => {
      if (body.amount.amount === "0") return err(domainError("InvalidAmount"));
      const [row] = await tm
        .executor()
        .insert(probe)
        .values({ userId: user!.id, amount: BigInt(body.amount.amount) })
        .returning();
      return ok({
        status: 201,
        body: { id: row!.id, minor: row!.amount },
        headers: [["location", `/p/${row!.id}`]],
      });
    }),
});

const list = defineRoute({
  auth: "required",
  query: PaginationQuerySchema,
  handler: async ({ query }) => {
    const cursor = query.cursor ? decodeCursor(query.cursor) : ok(null);
    if (!cursor.ok) return cursor;
    const rows = await db
      .select({ id: probe.id })
      .from(probe)
      .where(cursor.value ? gt(probe.id, cursor.value.id) : undefined)
      .orderBy(asc(probe.id))
      .limit(query.limit + 1);
    return ok({ status: 200, body: toPage(rows, query.limit, (r) => ({ sortKey: r.id, id: r.id })) });
  },
});

const update = defineRoute({
  auth: "required",
  body: z.object({ amount: MoneySchema }),
  handler: async ({ request, body, params }) => {
    const expected = ifMatchVersion(request);
    if (!expected.ok) return expected;
    const [row] = await db
      .update(probe)
      .set({ amount: BigInt(body.amount.amount), version: sql`${probe.version} + 1` })
      .where(
        and(
          eq(probe.id, params.id!),
          expected.value === null ? undefined : eq(probe.version, expected.value),
        ),
      )
      .returning();
    if (!row) return err(domainError("PreconditionFailed"));
    return ok({ status: 200, body: { id: row.id }, headers: [["etag", etagOf(row.version)]] });
  },
});

const post = (key: string | null, minor: string, as = "ana") =>
  create(
    new Request("http://localhost/api/v1/probe", {
      method: "POST",
      headers: { "x-as": as, ...(key === null ? {} : { "idempotency-key": key }) },
      body: JSON.stringify({ amount: { amount: minor, currency: "COP" } }),
    }),
  );
const rowsCount = async () => (await db.select({ n: count() }).from(probe))[0]!.n;
const seed = (n: number) =>
  db.execute(sql`INSERT INTO http_probe (user_id, amount) SELECT 'u-ana', 100 FROM generate_series(1, ${n})`);

beforeAll(async () => {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS http_probe (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, amount bigint NOT NULL,
    version integer NOT NULL DEFAULT 1)`);
});
beforeEach(() => db.execute(sql`TRUNCATE http_probe; TRUNCATE idempotency_keys`));
afterAll(() => pool.end());

describe("idempotency", () => {
  it("returns the original response, headers included, for a replayed request", async () => {
    const first = await post("7f3c9a1e", "8500000");
    const second = await post("7f3c9a1e", "8500000");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("location")).toBe(first.headers.get("location"));
    expect(await second.json()).toEqual(await first.json());
    expect(await rowsCount()).toBe(1);
  });

  it("rejects reusing a key with a different payload", async () => {
    await post("7f3c9a1e", "8500000");
    const response = await post("7f3c9a1e", "9500000");
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IdempotencyKeyConflict");
    expect(await rowsCount()).toBe(1);
  });

  it("creates exactly one record when duplicates arrive concurrently", async () => {
    const [a, b] = await Promise.all([post("concurrent-1", "8500000"), post("concurrent-1", "8500000")]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await a.json()).toEqual(await b.json());
    expect(await rowsCount()).toBe(1);
  });

  it("scopes keys per user", async () => {
    await post("shared-key", "100", "ana");
    const other = await post("shared-key", "100", "juan");
    expect(other.status).toBe(201);
    expect(await rowsCount()).toBe(2);
  });

  it("does not store failed requests, so a corrected retry with a new payload succeeds", async () => {
    const failed = await post("retry-1", "0");
    expect(failed.status).toBe(422);
    const retried = await post("retry-1", "100");
    expect(retried.status).toBe(201);
    expect(await rowsCount()).toBe(1);
  });

  it("rejects a malformed key", async () => {
    const response = await post("bad key!", "100");
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("InvalidIdempotencyKey");
    expect(await rowsCount()).toBe(0);
  });

  it("ignores requests without a key", async () => {
    await post(null, "100");
    await post(null, "100");
    expect(await rowsCount()).toBe(2);
  });

  it("forgets keys older than 24 hours", async () => {
    await post("old-key", "100");
    await db.execute(sql`UPDATE idempotency_keys SET created_at = now() - interval '25 hours'`);
    const again = await post("old-key", "100");
    expect(again.status).toBe(201);
    expect(await rowsCount()).toBe(2);
  });
});

describe("cursor pagination", () => {
  const page = (query: string) => list(new Request(`http://localhost/api/v1/probe${query}`));

  it.each([
    ["", 200, 50],
    ["?limit=200", 200, 200],
    ["?limit=201", 422, 0],
  ])("enforces limits for %s", async (query, status, items) => {
    await seed(250);
    const response = await page(query);
    expect(response.status).toBe(status);
    if (status === 200) expect((await response.json()).items).toHaveLength(items);
  });

  it("visits every record once when following nextCursor", async () => {
    await seed(120);
    const sizes: number[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const body: { items: { id: string }[]; nextCursor: string | null } = await (
        await page(cursor ? `?cursor=${cursor}` : "")
      ).json();
      sizes.push(body.items.length);
      body.items.forEach((item) => seen.add(item.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen.size).toBe(120);
  });

  it("returns 422 InvalidCursor for a tampered cursor", async () => {
    const response = await page("?cursor=garbage!!");
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("InvalidCursor");
  });
});

describe("optimistic concurrency", () => {
  const patch = (id: string, ifMatch: string) =>
    update(
      new Request(`http://localhost/api/v1/probe/${id}`, {
        method: "PATCH",
        headers: { "if-match": ifMatch },
        body: JSON.stringify({ amount: { amount: "500", currency: "COP" } }),
      }),
      { params: Promise.resolve({ id }) },
    );

  it("accepts a matching If-Match and returns the next ETag", async () => {
    const [row] = await db.insert(probe).values({ userId: "u-ana", amount: 100n, version: 3 }).returning();
    const response = await patch(row!.id, '"3"');
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"4"');
  });

  it("rejects a stale If-Match with 412 and leaves the row unchanged", async () => {
    const [row] = await db.insert(probe).values({ userId: "u-ana", amount: 100n, version: 4 }).returning();
    const response = await patch(row!.id, '"3"');
    expect(response.status).toBe(412);
    expect((await response.json()).code).toBe("PreconditionFailed");
    const [after] = await db.select().from(probe).where(eq(probe.id, row!.id));
    expect(after!.amount).toBe(100n);
    expect(after!.version).toBe(4);
  });
});
