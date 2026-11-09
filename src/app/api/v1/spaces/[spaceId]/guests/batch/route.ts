import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { AddGuestsBodySchema, memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** P309: several guests in one request and one transaction, all or nothing. */
export const POST = defineRoute({
  auth: "required",
  body: AddGuestsBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.addGuests({
      spaceId: params.spaceId!,
      userId: user!.id,
      guests: body.guests,
    });
    return result.ok ? ok({ status: 201, body: { items: result.value.map(memberDto) } }) : result;
  },
});
