import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  friendRequestsDto,
  SendFriendRequestBodySchema,
  sentFriendRequestDto,
} from "@/modules/spaces/contracts/friend-requests.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P339: the friend requests the signed-in person received and sent. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().spaces.listFriendRequests(user!.id);
    return result.ok ? ok({ status: 200, body: friendRequestsDto(result.value) }) : result;
  },
});

/** Ruling P339: a request to someone's exact @; 201 when new, 200 when the pair's open one answered or accepted. */
export const POST = defineRoute({
  auth: "required",
  body: SendFriendRequestBodySchema,
  handler: async ({ user, body }) => {
    const result = await getContainer().spaces.sendFriendRequest({
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
      handle: body.handle,
    });
    return result.ok
      ? ok({ status: result.value.created ? 201 : 200, body: sentFriendRequestDto(result.value) })
      : result;
  },
});
