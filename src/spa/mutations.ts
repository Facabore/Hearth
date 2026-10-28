import { MutationObserver, type QueryClient } from "@tanstack/react-query";
import { markSettledWrite, type WritePlan, type WriteResult } from "./write-plan";

class Refused extends Error {
  constructor(readonly result: WriteResult) {
    super(`The API refused the write: ${result.response.status}`);
    this.name = "Refused";
  }
}

/**
 * One planned write as a TanStack Query mutation: its optimistic change first, rolled back when the API refuses, and
 * on success its answer and invalidations. The caller gets the client's own answer, refusal or not.
 */
export const runPlanned = (
  queryClient: QueryClient,
  mutationKey: readonly unknown[],
  plan: WritePlan,
  send: () => Promise<WriteResult>,
): Promise<WriteResult> =>
  new MutationObserver<WriteResult, unknown, void, (() => void) | undefined>(queryClient, {
    mutationKey,
    mutationFn: async () => {
      const result = await send();
      if (!result.response.ok) throw new Refused(result);
      return result;
    },
    onMutate: () => plan.optimistic?.(queryClient),
    onError: (_error, _variables, rollback) => rollback?.(),
    onSuccess: (result) => {
      plan.accepted(queryClient, result.data);
      markSettledWrite(queryClient);
    },
  })
    .mutate()
    .catch((error: unknown) => {
      if (error instanceof Refused) return error.result;
      throw error;
    });
