import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  AddLineBodySchema,
  lineFromBody,
  planSuccess,
} from "@/modules/budgeting/contracts/budgeting.contract";
import { ifMatchVersion } from "@/shared/http";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: AddLineBodySchema,
  handler: async ({ request, user, params, body }) => {
    // Spec 7: If-Match is checked when present; a stale version is 412.
    const expectedVersion = ifMatchVersion(request);
    if (!expectedVersion.ok) return expectedVersion;
    const line = lineFromBody(body);
    if (!line.ok) return line;
    const result = await getContainer().budgeting.addLine({
      spaceId: params.spaceId!,
      userId: user!.id,
      planId: params.planId!,
      expectedVersion: expectedVersion.value,
      line: line.value,
    });
    return result.ok ? ok(planSuccess(result.value, 201)) : result;
  },
});
