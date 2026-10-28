import type { QueryClient } from "@tanstack/react-query";
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

const settled = new WeakSet<QueryClient>();

/** A planned write was accepted and has already updated what it changed (`mutations.ts`). */
export const markSettledWrite = (queryClient: QueryClient): void => {
  settled.add(queryClient);
};

/**
 * The components call `router.refresh()` after a save, as the Next.js UI needs. A write that went through a plan has
 * already updated what it changed, so that refresh has nothing left to read: it takes this mark and stops
 * (`next/navigation`'s adapter).
 */
export const takeSettledWrite = (queryClient: QueryClient): boolean => settled.delete(queryClient);

export type Send = (
  path: string,
  init?: { params?: { path?: Record<string, string> }; body?: unknown },
) => Promise<WriteResult>;

/**
 * The components' client with their writes run as TanStack Query mutations (ADR 0006): a planned write applies its
 * optimistic change, rolls it back when the API refuses, and on success writes the answer into the cache and
 * invalidates what it touched. The component still gets the client's own answer, so a refusal shows its code next to
 * its field (P118) as before. Reads, and writes no plan claims, pass through untouched. The plans and the mutation
 * runner load with the first write, or before it with the first screen that can write, never with the app shell.
 */
export const trackWrites = (
  api: Api,
  queryClient: QueryClient,
  planner: () => Promise<WritePlanner>,
): Api => {
  const write =
    (method: WriteCall["method"]): Send =>
    async (path, init) => {
      const send = () => (api[method] as unknown as Send)(path, init);
      const [plans, { runPlanned }] = await Promise.all([planner(), import("./mutations")]);
      const plan = plans({ method, path, params: init?.params?.path ?? {}, body: init?.body }, queryClient);
      return plan ? runPlanned(queryClient, [method, path], plan, send) : send();
    };
  return { ...api, POST: write("POST"), PATCH: write("PATCH"), DELETE: write("DELETE") } as unknown as Api;
};
