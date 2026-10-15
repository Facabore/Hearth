import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { capacitySuggestionDto } from "@/modules/budgeting/contracts/budgeting.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().budgeting.suggestCapacity({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
    });
    return result.ok ? ok({ status: 200, body: capacitySuggestionDto(result.value) }) : result;
  },
});
