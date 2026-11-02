"use client";

import { useState } from "react";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { listQueryOf } from "./list-href";

interface MoreState {
  /** What the rows were loaded for: another filter or first page starts them afresh. */
  readonly key: string;
  readonly rows: readonly TransactionDto[];
  readonly next: string | null;
  readonly problem: Problem | null;
}

/**
 * HU-E9-03: the next 50 rows with the list's own query, held beside the first page so the list groups every row it
 * has by day (a day continued from the page above stays under one heading, and its total waits for its last row).
 */
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
  const key = JSON.stringify([spaceId, query, cursor]);
  const fresh: MoreState = { key, rows: [], next: cursor, problem: null };
  const [held, setHeld] = useState<MoreState>(fresh);
  const [pending, setPending] = useState(false);
  const state = held.key === key ? held : fresh;
  const more = async () => {
    if (!state.next || pending) return;
    setPending(true);
    const update = (change: Partial<MoreState>) =>
      setHeld((now) => ({ ...(now.key === key ? now : fresh), ...change }));
    try {
      const { data, error, response } = await (api ?? browserApi()).GET(
        "/api/v1/spaces/{spaceId}/transactions",
        {
          params: { path: { spaceId }, query: { ...query, limit: 50, cursor: state.next } },
        },
      );
      if (data) update({ rows: [...state.rows, ...data.items], next: data.nextCursor, problem: null });
      else update({ problem: problemFrom(error, response) });
    } catch (error) {
      update({ problem: problemFrom(error, undefined) });
    }
    setPending(false);
  };
  return { rows: state.rows, next: state.next, problem: state.problem, pending, more };
}
