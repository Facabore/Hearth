import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { invitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.revokeInvitation({
      spaceId: params.spaceId!,
      userId: user!.id,
      invitationId: params.invitationId!,
    });
    return result.ok ? ok({ status: 200, body: invitationDto(result.value) }) : result;
  },
});
