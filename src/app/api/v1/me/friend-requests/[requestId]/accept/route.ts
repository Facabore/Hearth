import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P339: the recipient accepts; the answer names the pair's direct space. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.acceptFriendRequest({
      requestId: params.requestId!,
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
    });
    return result.ok ? ok({ status: 200, body: { spaceId: result.value.spaceId } }) : result;
  },
});
