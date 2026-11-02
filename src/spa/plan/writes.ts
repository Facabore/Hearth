import type { BudgetPlanDto, SpaceDto } from "@/shared/ui/api/dto";
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
    accepted: (queryClient, data) => {
      // Every plan write answers the plan with its new version (ruling P206). Kept at once, so a write that follows
      // before the plan is read again (a line added right after saving the capacities) sends that version, not the
      // one this write made stale, and no conflict is reported that nobody else caused.
      const plan = data as Partial<BudgetPlanDto> | undefined;
      if (typeof plan?.id === "string" && typeof plan.version === "number")
        queryClient.setQueryData(moduleKeys.plan(spaceId, plan.id), plan);
      void queryClient.invalidateQueries({ queryKey: moduleKeys.plans(spaceId) });
      void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(spaceId) });
      const spaces = queryClient.getQueryData<SpaceDto[]>(queryKeys.spaces) ?? [];
      const personal = spaces.find((space) => space.kind === "PERSONAL");
      if (personal && personal.id !== spaceId)
        void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(personal.id) });
    },
  };
};
