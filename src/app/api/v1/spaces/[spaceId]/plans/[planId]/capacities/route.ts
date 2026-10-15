import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  capacitiesFromBody,
  planSuccess,
  SetCapacitiesBodySchema,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: SetCapacitiesBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const capacities = capacitiesFromBody(body);
    if (!capacities.ok) return capacities;
    const result = await getContainer().budgeting.setCapacities({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
      capacities: capacities.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
