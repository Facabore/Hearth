import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  AllocationBodySchema,
  allocationFromBody,
  planSuccess,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: AllocationBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const allocation = allocationFromBody(body);
    if (!allocation.ok) return allocation;
    const result = await getContainer().budgeting.allocateLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      allocation: allocation.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
