import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  AddGuestFriendBodySchema,
  friendDto,
  myFriendsDto,
} from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P338: Amigos, each person the signed-in person shares a direct space with. */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().balances.listMyFriends(user!.id);
    return result.ok ? ok({ status: 200, body: myFriendsDto(result.value) }) : result;
  },
});

/** Ruling P339 (S5): a friend who does not use Hearth, added at once as a guest; the answer is their Amigos row. */
export const POST = defineRoute({
  auth: "required",
  body: AddGuestFriendBodySchema,
  handler: async ({ user, body }) => {
    const { spaces, balances } = getContainer();
    const added = await spaces.addGuestFriend({
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
      guestName: body.displayName,
    });
    if (!added.ok) return added;
    const friend = await balances.getMyFriend({ userId: user!.id, spaceId: added.value.spaceId });
    return friend.ok ? ok({ status: 201, body: friendDto(friend.value) }) : friend;
  },
});
