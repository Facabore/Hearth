import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryGroupDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** P337: brings an archived group back with the categories archiving it took. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.restoreCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      groupId: params.groupId!,
    });
    return result.ok ? ok({ status: 200, body: categoryGroupDto(result.value) }) : result;
  },
});
