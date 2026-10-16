import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ request, user, params }) => {
    // Spec 7, HU-E6-07: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.activatePlan({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
