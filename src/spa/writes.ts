import type { QueryClient } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";
import { forgetSettledWrite, type WriteCall, type WritePlanner, type WriteResult } from "./write-plan";

export { takeSettledWrite } from "./write-plan";
export type { WriteCall, WritePlan, WritePlanner, WriteResult } from "./write-plan";

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
      // A new write makes any earlier mark stale: only the refresh() right after a planned save may skip its reads.
      forgetSettledWrite(queryClient);
      // A plan that cannot load (offline, or a chunk gone after a release) never stops the save: it is sent as it is,
      // and the components' refresh() reads the screen again.
      const loaded = await Promise.all([planner(), import("./mutations")]).catch(() => null);
      if (!loaded) return send();
      const [plans, { runPlanned }] = loaded;
      const plan = plans({ method, path, params: init?.params?.path ?? {}, body: init?.body }, queryClient);
      return plan ? runPlanned(queryClient, [method, path], plan, send) : send();
    };
  return { ...api, POST: write("POST"), PATCH: write("PATCH"), DELETE: write("DELETE") } as unknown as Api;
};
