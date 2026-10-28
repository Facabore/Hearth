import type { SpaceDto } from "@/shared/ui/api/dto";
import { queryKeys } from "../queries";
import { moduleKeys } from "../reads";
import type { WritePlanner } from "../write-plan";

const PLANS = /^\/api\/v1\/spaces\/\{spaceId\}\/plans(\/|$)/;

/**
 * HU-E9-08's writes: a plan created or copied, activated or closed, its capacities, and a line added, edited, funded,
 * given categories or removed. They change the space's plans and every figure the Plan tab computes from them (D7),
 * the person's own among them when the space is a shared one (My spending counts their share, D11); the ledger, the
 * accounts and the balances stay as they were.
 */
export const planWrites: WritePlanner = (call) => {
  if (!PLANS.test(call.path)) return null;
  const { spaceId = "" } = call.params;
  return {
    accepted: (queryClient) => {
      void queryClient.invalidateQueries({ queryKey: moduleKeys.plans(spaceId) });
      void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(spaceId) });
      const spaces = queryClient.getQueryData<SpaceDto[]>(queryKeys.spaces) ?? [];
      const personal = spaces.find((space) => space.kind === "PERSONAL");
      if (personal && personal.id !== spaceId)
        void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(personal.id) });
    },
  };
};
