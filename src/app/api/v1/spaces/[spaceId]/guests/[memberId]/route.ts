import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const DELETE = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.removeGuest({
      spaceId: params.spaceId!,
      userId: user!.id,
      memberId: params.memberId!,
    });
    return result.ok ? ok({ status: 204 }) : result;
  },
});
