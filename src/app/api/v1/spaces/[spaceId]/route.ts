import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { UpdateSpaceBodySchema } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.getSpace({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateSpaceBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.updateSettings({
      spaceId: params.spaceId!,
      userId: user!.id,
      changes: body,
    });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
