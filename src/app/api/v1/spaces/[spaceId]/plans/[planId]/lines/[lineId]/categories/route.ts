import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { MapCategoriesBodySchema, planSuccess } from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PUT = defineRoute({
  auth: "required",
  body: MapCategoriesBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const result = await getContainer().budgeting.mapCategories({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      categoryIds: body.categoryIds,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
