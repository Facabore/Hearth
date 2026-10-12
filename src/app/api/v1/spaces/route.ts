import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user }) => {
    const result = await getContainer().spaces.listMySpaces(user!.id);
    return result.ok ? ok({ status: 200, body: { items: result.value } }) : result;
  },
});
