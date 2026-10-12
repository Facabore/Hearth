import { z } from "zod";
import { domainError, err, ok, type Result } from "@/shared/kernel";

export const PaginationQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Keyset position: the last row's sort key plus its id as the tie-breaker. */
export interface Cursor {
  readonly sortKey: string;
  readonly id: string;
}

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify([cursor.sortKey, cursor.id]), "utf8").toString("base64url");

export const decodeCursor = (raw: string): Result<Cursor> => {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    ) {
      return ok({ sortKey: value[0], id: value[1] });
    }
  } catch {
    // Not base64url JSON: reported below like any other malformed cursor.
  }
  return err(domainError("InvalidCursor"));
};

/** `rows` must hold up to `limit + 1` items ordered by (sortKey, id); the extra row signals a next page. */
export const toPage = <T>(rows: readonly T[], limit: number, cursorOf: (row: T) => Cursor) => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
};
