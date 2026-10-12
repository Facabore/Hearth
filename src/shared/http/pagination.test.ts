import { describe, expect, it } from "vitest";
import { PaginationQuerySchema, decodeCursor, encodeCursor, toPage } from "./pagination";

describe("pagination", () => {
  it("defaults to 50 and caps at 200", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(PaginationQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(PaginationQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ limit: "1.5" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ cursor: "x".repeat(513) }).success).toBe(false);
  });

  it("round-trips an opaque cursor, including unicode sort keys", () => {
    for (const cursor of [
      { sortKey: "2026-11-01", id: "a1" },
      { sortKey: "Ñandú, café", id: "b2" },
    ]) {
      expect(decodeCursor(encodeCursor(cursor))).toEqual({ ok: true, value: cursor });
    }
  });

  it.each([
    "not-base64!!",
    Buffer.from("{}").toString("base64url"),
    Buffer.from('["a"]').toString("base64url"),
    Buffer.from('["a", 1]').toString("base64url"),
    Buffer.from('["a", "b", "c"]').toString("base64url"),
  ])("rejects the tampered cursor %s", (raw) => {
    const decoded = decodeCursor(raw);
    expect(!decoded.ok && decoded.error.code).toBe("InvalidCursor");
  });

  it("builds a page and the next cursor from limit + 1 rows", () => {
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const page = toPage(rows, 2, (r) => ({ sortKey: r.id, id: r.id }));
    expect(page.items).toEqual([{ id: "1" }, { id: "2" }]);
    expect(page.nextCursor).toBe(encodeCursor({ sortKey: "2", id: "2" }));
    expect(toPage(rows, 3, (r) => ({ sortKey: r.id, id: r.id })).nextCursor).toBeNull();
    expect(toPage([], 3, (r: { id: string }) => ({ sortKey: r.id, id: r.id }))).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
