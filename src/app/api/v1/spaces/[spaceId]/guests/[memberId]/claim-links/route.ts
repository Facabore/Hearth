import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { createdInvitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.createGuestClaim({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
    });
    return result.ok ? ok({ status: 201, body: createdInvitationDto(result.value) }) : result;
  },
});
