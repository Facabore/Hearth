import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { CreateInvitationBodySchema, createdInvitationDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CreateInvitationBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.createInvitation({
      spaceId: params.spaceId!,
      userId: user!.id,
      role: body.role,
      target: body.kind === "EMAIL" ? { kind: "EMAIL", email: body.email } : { kind: "LINK" },
    });
    return result.ok ? ok({ status: 201, body: createdInvitationDto(result.value) }) : result;
  },
});
