import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  lineChangesFromBody,
  planSuccess,
  UpdateLineBodySchema,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateLineBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const changes = lineChangesFromBody(body);
    if (!changes.ok) return changes;
    const result = await getContainer().budgeting.updateLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      lineId: params.lineId!,
      expectedVersion: expectedVersion.value,
      changes: changes.value,
    });
    return result.ok ? ok(planSuccess(result.value)) : result;
  },
});
