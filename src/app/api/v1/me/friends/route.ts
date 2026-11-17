import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { myFriendsDto } from "@/modules/balances/contracts/balances.contract";
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
