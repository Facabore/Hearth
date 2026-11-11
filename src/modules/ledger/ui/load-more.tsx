"use client";

import { useState } from "react";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { ActivityItemDto, TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { listQueryOf, myListQueryOf } from "./list-href";

/** How many rows each "Cargar más" asks for. */
const MORE = 50;

interface MoreState<T> {
  /** What the rows were loaded for: another filter or first page starts them afresh. */
  readonly key: string;
  readonly rows: readonly T[];
  readonly next: string | null;
  readonly problem: Problem | null;
}

/** What the typed client answers for one page: its rows and the next cursor, or the problem. */
type PageAnswer<T> = Promise<{
  readonly data?: { readonly items: readonly T[]; readonly nextCursor: string | null } | undefined;
  readonly error?: unknown;
  readonly response: Response;
}>;

/**
 * HU-E9-03: the next pages of a list, held beside its first page so the list groups every row it has by day (a day
 * continued from the page above stays under one heading). `key` names what the rows are for; `read` asks for the page
 * after a cursor.
 */
function usePages<T>({
  key: scope,
  cursor,
  read,
}: {
  readonly key: unknown;
  readonly cursor: string | null;
  readonly read: (cursor: string) => PageAnswer<T>;
}) {
  const key = JSON.stringify([scope, cursor]);
  const fresh: MoreState<T> = { key, rows: [], next: cursor, problem: null };
  const [held, setHeld] = useState<MoreState<T>>(fresh);
  const [pending, setPending] = useState(false);
  const state = held.key === key ? held : fresh;
  const more = async () => {
    if (!state.next || pending) return;
    setPending(true);
    const update = (change: Partial<MoreState<T>>) =>
      setHeld((now) => ({ ...(now.key === key ? now : fresh), ...change }));
    try {
      const { data, error, response } = await read(state.next);
      if (data) update({ rows: [...state.rows, ...data.items], next: data.nextCursor, problem: null });
      else update({ problem: problemFrom(error, response) });
    } catch (error) {
      update({ problem: problemFrom(error, undefined) });
    }
    setPending(false);
  };
  return { rows: state.rows, next: state.next, problem: state.problem, pending, more };
}

/** HU-E9-03: a space's next 50 rows with the list's own query. */
export function useLoadMore({
  spaceId,
  query,
  cursor,
  api,
}: {
  readonly spaceId: string;
  readonly query: ReturnType<typeof listQueryOf>;
  readonly cursor: string | null;
  /** For tests: the client to call; the browser's own by default. */
  readonly api?: Api | undefined;
}) {
  return usePages<TransactionDto>({
    key: [spaceId, query],
    cursor,
    read: (next) =>
      (api ?? browserApi()).GET("/api/v1/spaces/{spaceId}/transactions", {
        params: { path: { spaceId }, query: { ...query, limit: MORE, cursor: next } },
      }),
  });
}

/** Ruling P319: the personal Movimientos' next 50 rows across every space, with the list's own query. */
export function useMyLoadMore({
  query,
  cursor,
  api,
}: {
  readonly query: ReturnType<typeof myListQueryOf>;
  readonly cursor: string | null;
  /** For tests: the client to call; the browser's own by default. */
  readonly api?: Api | undefined;
}) {
  return usePages<ActivityItemDto>({
    key: ["me", query],
    cursor,
    read: (next) =>
      (api ?? browserApi()).GET("/api/v1/me/transactions", {
        params: { query: { ...query, limit: MORE, cursor: next } },
      }),
  });
}
