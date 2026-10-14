import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.claimGuestPlace({ token: params.token!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: result.value }) : result;
  },
});
