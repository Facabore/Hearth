import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P339: the recipient turns the request down, silently. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.rejectFriendRequest({
      requestId: params.requestId!,
      userId: user!.id,
      userName: user!.name,
      locale: user!.locale,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
