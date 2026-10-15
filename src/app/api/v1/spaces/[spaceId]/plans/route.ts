import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreatePlanBodySchema, planCreated } from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreatePlanBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().budgeting.createPlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      period: body.period,
    });
    return result.ok ? ok(planCreated(result.value)) : result;
  },
});
