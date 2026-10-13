import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { AddGuestBodySchema, memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: AddGuestBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.addGuest({
      spaceId: params.spaceId!,
      userId: user!.id,
      displayName: body.displayName,
      contactEmail: body.contactEmail,
    });
    return result.ok ? ok({ status: 201, body: memberDto(result.value) }) : result;
  },
});
