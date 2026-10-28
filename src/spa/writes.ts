import { MutationObserver, type QueryClient } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";

/** One write as the components send it: the method, the path template and its parameters, and the body. */
export interface WriteCall {
  readonly method: "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** What the generated client hands back: `openapi-fetch` answers a refusal instead of throwing it. */
export interface WriteResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response: Response;
}

/**
 * What one write does to the query cache (ADR 0006).
 * - `optimistic` moves the screen before the API answers and returns how to put it back if the API refuses;
 * - `accepted` writes the API's answer into the cache and invalidates exactly the keys the write changed.
 */
export interface WritePlan {
  readonly optimistic?: (queryClient: QueryClient) => Promise<() => void>;
  readonly accepted: (queryClient: QueryClient, data: unknown) => void;
}

/** A module's writes: the plan for a call it owns, or null for one it does not. */
export type WritePlanner = (call: WriteCall, queryClient: QueryClient) => WritePlan | null;

class Refused extends Error {
  constructor(readonly result: WriteResult) {
    super(`The API refused the write: ${result.response.status}`);
    this.name = "Refused";
  }
}

const settled = new WeakSet<QueryClient>();

/**
 * The components call `router.refresh()` after a save, as the Next.js UI needs. A write that went through a plan has
 * already updated what it changed, so that refresh has nothing left to read: it takes this mark and stops
 * (`next/navigation`'s adapter).
 */
export const takeSettledWrite = (queryClient: QueryClient): boolean => settled.delete(queryClient);

type Send = (
  path: string,
  init?: { params?: { path?: Record<string, string> }; body?: unknown },
) => Promise<WriteResult>;

/**
 * The components' client with their writes run as TanStack Query mutations (ADR 0006): a planned write applies its
 * optimistic change, rolls it back when the API refuses, and on success writes the answer into the cache and
 * invalidates what it touched. The component still gets the client's own answer, so a refusal shows its code next to
 * its field (P118) as before. Reads, and writes no plan claims, pass through untouched.
 */
export const trackWrites = (api: Api, queryClient: QueryClient, planner: WritePlanner): Api => {
  const write =
    (method: WriteCall["method"]): Send =>
    (path, init) => {
      const send = () => (api[method] as unknown as Send)(path, init);
      const plan = planner({ method, path, params: init?.params?.path ?? {}, body: init?.body }, queryClient);
      if (!plan) return send();
      const observer = new MutationObserver<WriteResult, unknown, void, (() => void) | undefined>(
        queryClient,
        {
          mutationKey: [method, path],
          mutationFn: async () => {
            const result = await send();
            if (!result.response.ok) throw new Refused(result);
            return result;
          },
          onMutate: () => plan.optimistic?.(queryClient),
          onError: (_error, _variables, rollback) => rollback?.(),
          onSuccess: (result) => {
            plan.accepted(queryClient, result.data);
            settled.add(queryClient);
          },
        },
      );
      return observer.mutate().catch((error: unknown) => {
        if (error instanceof Refused) return error.result;
        throw error;
      });
    };
  return { ...api, POST: write("POST"), PATCH: write("PATCH"), DELETE: write("DELETE") } as unknown as Api;
};
