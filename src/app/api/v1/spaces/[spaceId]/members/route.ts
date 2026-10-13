import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { memberDto } from "@/modules/spaces/contracts/spaces.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().spaces.listMembers({ spaceId: params.spaceId!, userId: user!.id });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(memberDto) } }) : result;
  },
});
