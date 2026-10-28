import type { QueryClient } from "@tanstack/react-query";

// What a write plan is and the mark a settled one leaves, apart from the client that runs them (`writes.ts`) and the
// mutation runner (`mutations.ts`), which both use them: neither imports the other.

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

/** A new write makes the mark stale (`writes.ts`). */
export const forgetSettledWrite = (queryClient: QueryClient): void => {
  settled.delete(queryClient);
};

/**
 * The components call `router.refresh()` after a save, as the Next.js UI needs. A write that went through a plan has
 * already updated what it changed, so that refresh has nothing left to read: it takes this mark and stops
 * (`next/navigation`'s adapter).
 */
export const takeSettledWrite = (queryClient: QueryClient): boolean => settled.delete(queryClient);
