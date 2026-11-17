import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { FriendNicknameBodySchema, friendNameDto } from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P338: the apodo of the other member of one of the signed-in person's direct spaces. */
export const PATCH = defineRoute({
  auth: "required",
  body: FriendNicknameBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().spaces.setFriendNickname({
      spaceId: params.spaceId!,
      userId: user!.id,
      nickname: body.nickname,
    });
    return result.ok ? ok({ status: 200, body: friendNameDto(result.value) }) : result;
  },
});

/** Ruling P339 (S7): removes a friend once the two are even; the direct space is archived and its history kept. */
export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.removeFriend({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
