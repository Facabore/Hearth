import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.acceptInvitation({
      token: params.token!,
      userId: user!.id,
      userEmail: user!.email,
      userName: user!.name,
    });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
