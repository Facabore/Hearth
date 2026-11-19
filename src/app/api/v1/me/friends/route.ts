import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  AddGuestFriendBodySchema,
  friendDto,
  myFriendsDto,
} from "@/modules/balances/contracts/balances.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/**
 * Ruling P338: Amigos, each person the signed-in person shares a direct space with. Ruling P342 (S6): with debts in
 * several currencies, also what they add up to approximately in her currency at today's rate.
 */
export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const { balances } = getContainer();
    const result = await balances.listMyFriends(user!.id);
    if (!result.ok) return result;
    const approximate = await balances.approximateFriendTotals(user!.id, result.value);
    return ok({ status: 200, body: myFriendsDto(result.value, approximate) });
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
