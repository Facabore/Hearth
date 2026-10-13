import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ChangeMemberRoleBodySchema, memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const PATCH = defineRoute({
  auth: "required",
  body: ChangeMemberRoleBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.changeMemberRole({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
      role: body.role,
    });
    return result.ok ? ok({ status: 200, body: memberDto(result.value) }) : result;
  },
});
