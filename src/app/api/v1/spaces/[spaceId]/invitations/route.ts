import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  CreateInvitationBodySchema,
  createdInvitationDto,
  invitationDto,
} from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.listInvitations({
      spaceId: params.spaceId!,
      userId: user!.id,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(invitationDto) } }) : result;
  },
});

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
