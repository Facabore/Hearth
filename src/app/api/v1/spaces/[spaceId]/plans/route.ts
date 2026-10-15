import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  CreatePlanBodySchema,
  planCopied,
  planCreated,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreatePlanBodySchema,
  handler: async ({ user, params, body }) => {
    const budgeting = getContainer().budgeting;
    const input = { spaceId: params.spaceId!, userId: user!.id, period: body.period };
    // HU-E6-06: `copyFrom: "previous"` copies the plan of the previous period of the space's policy.
    if (body.copyFrom === "previous") {
      const copy = await budgeting.copyPlan(input);
      return copy.ok ? ok(planCopied(copy.value)) : copy;
    }
    const result = await budgeting.createPlan(input);
    return result.ok ? ok(planCreated(result.value)) : result;
  },
});
